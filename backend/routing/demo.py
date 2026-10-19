"""Real road geometry captured from Valhalla; synthetic weather is always labeled."""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

ORIGIN = {
    "name": "Chicago",
    "label": "Chicago, Illinois, United States",
    "lat": 41.8781,
    "lng": -87.6298,
    "timezone": "America/Chicago",
}
DESTINATION = {
    "name": "Detroit",
    "label": "Detroit, Michigan, United States",
    "lat": 42.3314,
    "lng": -83.0458,
    "timezone": "America/Detroit",
}


def demo_routes():
    data = json.loads((Path(__file__).parent / "fixtures" / "demo-routes.json").read_text())
    return [{**route, "source": "recorded Valhalla truck route"} for route in data]


def demo_forecasts(points):
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [
        (start + timedelta(hours=hour)).isoformat(timespec="seconds").replace("+00:00", "Z")
        for hour in range(168)
    ]
    result = {}
    for point in points:
        coordinate = round(point["lat"], 3), round(point["lng"], 3)
        if coordinate in result:
            continue
        lat, lng = coordinate
        wind, rain, snow = [], [], []
        for hour in range(168):
            # A moving weather system distinguishes road corridors and forecast hours.
            storm_lng = -85.6 + math.sin(hour / 12) * 0.65
            storm = math.exp(-(((lng - storm_lng) / 0.8) ** 2) - ((lat - 42.24) / 0.42) ** 2)
            wind.append(round(12 + 29 * storm + 4 * math.sin(hour / 8 + lat), 1))
            rain.append(round(0.02 + 0.32 * storm, 3))
            snow.append(0.0)
        result[coordinate] = {
            "times": times,
            "epochs": [(start + timedelta(hours=hour)).timestamp() for hour in range(168)],
            "wind": [round(max(0, value - 4), 1) for value in wind],
            "gust": wind,
            "rain": rain,
            "snow": snow,
            "temperature": [round(56 - 6 * math.sin(hour / 7), 1) for hour in range(168)],
        }
    return result
