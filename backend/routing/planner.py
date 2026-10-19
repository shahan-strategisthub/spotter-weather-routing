from bisect import bisect_left
from datetime import datetime, timedelta, timezone
from math import isfinite

from django.conf import settings

from .geometry import METERS_PER_MILE, checkpoints, corridor
from .providers import weather_forecasts
from .risk import classify, recommend, summarize


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def weather_at(forecast, when):
    if not forecast:
        return {
            "wind_mph": None,
            "gust_mph": None,
            "rain_in": None,
            "snow_in": None,
            "temperature_f": None,
            "forecast_time": None,
        }
    # Compare epoch times: ISO strings with differing second precision are unsafe.
    timestamp = when.timestamp()
    # Hourly rain/snow are preceding-hour totals. Use the interval containing ETA.
    epochs = forecast.get("epochs") or [
        datetime.fromisoformat(value).timestamp() for value in forecast["times"]
    ]
    index = bisect_left(epochs, timestamp)
    if index >= len(epochs) or timestamp < epochs[0]:
        return weather_at(None, when)
    return {
        "wind_mph": forecast["wind"][index],
        "gust_mph": forecast["gust"][index],
        "rain_in": forecast["rain"][index],
        "snow_in": forecast["snow"][index],
        "temperature_f": forecast["temperature"][index],
        "forecast_time": forecast["times"][index],
    }


def risk_for(weather, load):
    wind, gust = weather["wind_mph"], weather["gust_mph"]
    # Incomplete gust data is also unknown, rather than silently understating wind.
    effective = (
        max(wind, gust)
        if all(value is not None and isfinite(value) and value >= 0 for value in (wind, gust))
        else None
    )
    return classify(effective, weather["rain_in"], weather["snow_in"], load)


def plan(
    normalized_routes,
    departure,
    load,
    interval,
    origin,
    destination,
    forecast_loader=weather_forecasts,
    mode="live",
):
    route_checkpoints = [checkpoints(route, interval) for route in normalized_routes]
    cells = corridor(normalized_routes)
    forecasts = forecast_loader([point for route in route_checkpoints for point in route] + cells)
    routes = []
    for index, (raw, points) in enumerate(zip(normalized_routes, route_checkpoints)):
        for point in points:
            eta = departure + timedelta(seconds=point["elapsed_seconds"])
            forecast = forecasts.get((round(point["lat"], 3), round(point["lng"], 3)))
            point["eta"] = iso(eta)
            point["weather"] = weather_at(forecast, eta)
            point["risk"] = risk_for(point["weather"], load)
        total_miles = raw["distance_meters"] / METERS_PER_MILE
        routes.append(
            {
                "id": f"route-{index + 1}",
                "name": raw.get("name", f"Route {index + 1}"),
                "source": raw.get("source", "provider alternative"),
                "geometry": raw["coordinates"],
                "distance_miles": total_miles,
                "duration_seconds": raw["duration_seconds"],
                "arrival": iso(departure + timedelta(seconds=raw["duration_seconds"])),
                "eta_method": raw["eta_method"],
                "checkpoints": points,
                "summary": summarize(points, total_miles),
            }
        )
    # Send all 49 heatmap frames once; scrubbing is entirely local and makes no API calls.
    hours = [departure + timedelta(hours=hour) for hour in range(49)]
    for cell in cells:
        forecast = forecasts.get((round(cell["lat"], 3), round(cell["lng"], 3)))
        cell["frames"] = []
        for hour in hours:
            weather = weather_at(forecast, hour)
            risk = risk_for(weather, load)
            cell["frames"].append(
                {
                    "level": risk["level"],
                    "wind_mph": max(weather["wind_mph"], weather["gust_mph"])
                    if weather["wind_mph"] is not None and weather["gust_mph"] is not None
                    else None,
                    "rain_in": weather["rain_in"],
                    "snow_in": weather["snow_in"],
                }
            )
    warnings = []
    if len(routes) < 3:
        warnings.append(
            f"The routing provider found only {len(routes)} distinct road routes; all available options are shown."
        )
    if any(point["risk"]["level"] is None for route in routes for point in route["checkpoints"]):
        warnings.append(
            "Some checkpoint forecasts are unavailable or outside the forecast window. Affected routes cannot be recommended."
        )
    if any(frame["level"] is None for cell in cells for frame in cell["frames"]):
        warnings.append("Some corridor forecast cells are unavailable and are omitted from the heatmap.")
    selected = recommend(routes)
    return {
        "mode": mode,
        "generated_at": iso(datetime.now(timezone.utc)),
        "departure": iso(departure),
        "origin": origin,
        "destination": destination,
        "load_lb": load,
        "interval_miles": interval,
        "routes": routes,
        "recommended_route_id": selected,
        "recommendation_reason": "Ranked by fewest severe miles, then high miles, distance-weighted average risk, and travel time."
        if selected
        else "No route can be recommended: every option has no-travel conditions or missing forecasts. Change the departure time or trip.",
        "corridor": cells,
        "forecast_hours": [iso(hour) for hour in hours],
        "warnings": warnings,
        "providers": {
            "routing": "Valhalla truck / OpenStreetMap"
            if settings.ROUTING_PROVIDER == "valhalla"
            else "OSRM / OpenStreetMap",
            "weather": "Open-Meteo" if mode == "live" else "Synthetic sample weather",
        },
    }
