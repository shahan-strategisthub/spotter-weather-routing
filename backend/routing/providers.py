import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from hashlib import sha256
from math import cos, hypot, isfinite, radians

import httpx
from django.conf import settings
from django.core.cache import cache

from .geometry import haversine, normalize

logger = logging.getLogger(__name__)
TIMEOUT = httpx.Timeout(18, connect=6)


class ProviderError(Exception):
    pass


def get_json(url, params=None):
    try:
        response = httpx.get(
            url, params=params, timeout=TIMEOUT, headers={"User-Agent": "Corridor-Assessment/1.0"}
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Provider request failed: %s (%s)", url.split("?")[0], type(exc).__name__)
        raise ProviderError(
            "An external data service is unavailable. Please try again shortly, or explore the labeled sample trip."
        ) from exc


def geocode(query):
    key = "geocode:" + sha256(query.casefold().strip().encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    # Open-Meteo searches place names; accept a state/country suffix from the UI.
    name, *suffix = [part.strip() for part in query.split(",")]
    data = get_json(
        settings.GEOCODING_BASE_URL, {"name": name, "count": 10, "language": "en", "format": "json"}
    )
    places = [
        {
            "name": row["name"],
            "label": ", ".join(
                dict.fromkeys(filter(None, [row["name"], row.get("admin1"), row.get("country")]))
            ),
            "lat": row["latitude"],
            "lng": row["longitude"],
            "timezone": row.get("timezone", "UTC"),
        }
        for row in data.get("results", [])
    ]
    if suffix:
        needle = " ".join(suffix).casefold()
        places.sort(key=lambda place: needle not in place["label"].casefold())
    cache.set(key, places, 86400)
    return places


def decode_polyline(encoded):
    coordinates, index, latitude, longitude = [], 0, 0, 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            value, shift = 0, 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                value |= (byte & 31) << shift
                shift += 5
                if byte < 32:
                    break
            deltas.append(~(value >> 1) if value & 1 else value >> 1)
        latitude += deltas[0]
        longitude += deltas[1]
        coordinates.append([longitude / 1e6, latitude / 1e6])
    return coordinates


def valhalla_to_raw(trip):
    coordinates, legs, roads = [], [], []
    for leg in trip["legs"]:
        shape = decode_polyline(leg["shape"])
        distances = [haversine(a, b) for a, b in zip(shape, shape[1:])]
        durations = [0.0] * len(distances)
        for maneuver in leg["maneuvers"]:
            start, end = maneuver["begin_shape_index"], maneuver["end_shape_index"]
            distance = sum(distances[start:end])
            for index in range(start, end):
                durations[index] += maneuver["time"] * distances[index] / distance if distance else 0
            if maneuver.get("street_names"):
                roads.append((maneuver.get("length", 0), maneuver["street_names"][0]))
        # Each leg is normalized separately so turn and leg totals are preserved.
        sum_d, sum_t = sum(distances), sum(durations)
        if sum_d:
            distances = [distance * leg["summary"]["length"] * 1000 / sum_d for distance in distances]
        if sum_t:
            durations = [seconds * leg["summary"]["time"] / sum_t for seconds in durations]
        coordinates.extend(shape if not coordinates else shape[1:])
        legs.append({"annotation": {"distance": distances, "duration": durations}})
    main_roads = list(dict.fromkeys(name for _, name in sorted(roads, reverse=True)))[:2]
    return {
        "geometry": {"coordinates": coordinates},
        "distance": trip["summary"]["length"] * 1000,
        "duration": trip["summary"]["time"],
        "legs": legs,
        "name": " / ".join(main_roads) or "Road route",
        "eta_method": "maneuver durations, interpolated within each maneuver",
    }


def _request_routes(points, alternatives=2):
    if settings.ROUTING_PROVIDER == "valhalla":
        payload = {
            "locations": [{"lon": point[0], "lat": point[1]} for point in points],
            "costing": "truck",
            "alternates": alternatives,
            "directions_options": {"units": "kilometers"},
        }
        data = get_json(
            f"{settings.VALHALLA_BASE_URL}/route", {"json": json.dumps(payload, separators=(",", ":"))}
        )
        if "trip" not in data:
            raise ProviderError("No drivable truck route was found between these locations.")
        return [valhalla_to_raw(data["trip"])] + [
            valhalla_to_raw(row["trip"]) for row in data.get("alternates", [])
        ]
    coordinates = ";".join(f"{point[0]:.6f},{point[1]:.6f}" for point in points)
    data = get_json(
        f"{settings.OSRM_BASE_URL}/route/v1/driving/{coordinates}",
        {
            "overview": "full",
            "geometries": "geojson",
            "annotations": "distance,duration",
            "alternatives": alternatives,
            "steps": "false",
        },
    )
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ProviderError(
            "No drivable route was found between these locations. Choose locations connected by road."
        )
    return data["routes"]


def route_options(origin, destination):
    start, end = [origin["lng"], origin["lat"]], [destination["lng"], destination["lat"]]
    if haversine(start, end) < 1000:
        raise ProviderError("Choose an origin and destination at least one kilometer apart.")
    key = f"routes:{settings.ROUTING_PROVIDER}:{start[0]},{start[1]}:{end[0]},{end[1]}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    raw_routes = _request_routes([start, end])
    selected, seen = [], set()

    def add(raw, source):
        route = normalize(raw)
        # Compare a distance-normalized fingerprint, rather than provider IDs.
        from .geometry import at_distance

        fingerprint = tuple(
            tuple(round(value, 2) for value in at_distance(route, route["distance_meters"] * i / 20)[0])
            for i in range(21)
        )
        if fingerprint not in seen:
            seen.add(fingerprint)
            selected.append({**route, "source": source})

    for raw in raw_routes:
        add(raw, "provider alternative")
    if len(selected) < 3:
        # Obtain real road routes through two distinct corridor waypoints.
        # Never duplicate a route or invent a line to satisfy the count.
        mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        dx, dy = (end[0] - start[0]) * cos(radians(mid[1])), end[1] - start[1]
        length = hypot(dx, dy)
        offset = min(0.9, max(0.12, length * 0.18))
        waypoints = [
            [
                mid[0] - sign * dy / length * offset / max(0.15, cos(radians(mid[1]))),
                max(-85, min(85, mid[1] + sign * dx / length * offset)),
            ]
            for sign in (-1, 1)
        ]

        def detour(via):
            try:
                return _request_routes([start, via, end], alternatives=0)
            except ProviderError:
                return []

        with ThreadPoolExecutor(max_workers=2) as pool:
            for rows in pool.map(detour, waypoints):
                for raw in rows:
                    add(raw, "routed via corridor waypoint")
    result = selected[:3]
    if sum(route["distance_meters"] for route in result) / 1609.344 > 12000:
        raise ProviderError(
            "This trip exceeds the assessment server's coverage limit. Please choose a shorter trip."
        )
    cache.set(key, result, 1800)
    return result


def _parse_forecast(row):
    hourly = row.get("hourly", {})
    units = row.get("hourly_units", {})
    if (
        units.get("wind_speed_10m") not in ("mp/h", "mph")
        or units.get("wind_gusts_10m") not in ("mp/h", "mph")
        or units.get("rain") != "inch"
        or units.get("snowfall") != "inch"
    ):
        raise ProviderError("Weather provider returned unexpected measurement units.")
    times = hourly.get("time", [])
    fields = ("wind_speed_10m", "wind_gusts_10m", "rain", "snowfall", "temperature_2m")
    if not times or any(len(hourly.get(field, [])) != len(times) for field in fields):
        raise ProviderError("Weather provider returned incomplete hourly data.")
    # Provider gaps and malformed numeric values remain unknown and JSON-safe.
    for field in fields:
        hourly[field] = [
            value
            if isinstance(value, (float, int))
            and isfinite(value)
            and (field == "temperature_2m" or value >= 0)
            else None
            for value in hourly[field]
        ]
    timestamps = [time + "Z" for time in times]
    return {
        "times": timestamps,
        "epochs": [datetime.fromisoformat(time).timestamp() for time in timestamps],
        "wind": hourly["wind_speed_10m"],
        "gust": hourly["wind_gusts_10m"],
        "rain": hourly["rain"],
        "snow": hourly["snowfall"],
        "temperature": hourly["temperature_2m"],
    }


def weather_forecasts(points):
    """Batch requests; deduplicate cells and cache full hourly forecasts for 15 min."""
    unique = {(round(point["lat"], 3), round(point["lng"], 3)) for point in points}
    result, missing = {}, []
    for coordinate in sorted(unique):
        data = cache.get(f"weather:{coordinate[0]},{coordinate[1]}")
        if data is not None:
            result[coordinate] = data
        else:
            missing.append(coordinate)
    batches = [missing[index : index + 30] for index in range(0, len(missing), 30)]

    def fetch(batch):
        try:
            response = get_json(
                settings.WEATHER_BASE_URL,
                {
                    "latitude": ",".join(str(point[0]) for point in batch),
                    "longitude": ",".join(str(point[1]) for point in batch),
                    "hourly": "wind_speed_10m,wind_gusts_10m,rain,snowfall,temperature_2m",
                    "wind_speed_unit": "mph",
                    "precipitation_unit": "inch",
                    "temperature_unit": "fahrenheit",
                    "timezone": "GMT",
                    "forecast_days": 7,
                },
            )
            rows = response if isinstance(response, list) else [response]
            if len(rows) != len(batch):
                raise ProviderError("Incomplete multi-location weather response.")
            parsed = [(coordinate, _parse_forecast(row)) for coordinate, row in zip(batch, rows)]
            for coordinate, forecast in parsed:
                cache.set(f"weather:{coordinate[0]},{coordinate[1]}", forecast, 900)
            return parsed
        except ProviderError:
            # Missing data stays unknown. Never convert a service error to low risk.
            return [(coordinate, None) for coordinate in batch]

    with ThreadPoolExecutor(max_workers=3) as pool:
        for batch in pool.map(fetch, batches):
            result.update(batch)
    return result
