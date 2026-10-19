"""Distance-based checkpoints with cumulative road-segment travel times."""

from bisect import bisect_right
from math import asin, cos, radians, sin, sqrt

METERS_PER_MILE = 1609.344


def haversine(a, b):
    lon1, lat1, lon2, lat2 = map(radians, (*a, *b))
    value = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 6371008.8 * 2 * asin(min(1, sqrt(value)))


def normalize(raw):
    coords = raw["geometry"]["coordinates"]
    if len(coords) < 2 or raw["distance"] <= 0 or raw["duration"] <= 0:
        raise ValueError("Routing provider returned an empty route.")
    distances = [d for leg in raw["legs"] for d in leg.get("annotation", {}).get("distance", [])]
    durations = [d for leg in raw["legs"] for d in leg.get("annotation", {}).get("duration", [])]
    annotated = (
        len(distances) == len(durations) == len(coords) - 1 and sum(distances) > 0 and sum(durations) > 0
    )
    if not annotated:
        distances = [haversine(a, b) for a, b in zip(coords, coords[1:])]
        durations = distances[:]
    scale_d = raw["distance"] / sum(distances)
    scale_t = raw["duration"] / sum(durations)
    cumulative_d, cumulative_t = [0.0], [0.0]
    for distance, duration in zip(distances, durations):
        cumulative_d.append(cumulative_d[-1] + distance * scale_d)
        cumulative_t.append(cumulative_t[-1] + duration * scale_t)
    return {
        "coordinates": coords,
        "distances": cumulative_d,
        "times": cumulative_t,
        "distance_meters": raw["distance"],
        "duration_seconds": raw["duration"],
        "name": raw.get("name", "Road route"),
        "eta_method": raw.get(
            "eta_method", "segment durations" if annotated else "distance-proportional estimate"
        ),
    }


def at_distance(route, meters):
    meters = min(max(0, meters), route["distance_meters"])
    index = min(bisect_right(route["distances"], meters) - 1, len(route["coordinates"]) - 2)
    start, end = route["distances"][index : index + 2]
    fraction = (meters - start) / (end - start) if end > start else 0
    left, right = route["coordinates"][index : index + 2]
    coordinate = [left[axis] + (right[axis] - left[axis]) * fraction for axis in (0, 1)]
    seconds = route["times"][index] + (route["times"][index + 1] - route["times"][index]) * fraction
    return coordinate, seconds


def checkpoints(route, interval):
    distance = route["distance_meters"]
    step = interval * METERS_PER_MILE
    positions = [i * step for i in range(int(distance // step) + 1)]
    if distance - positions[-1] > 0.01:
        positions.append(distance)
    else:
        positions[-1] = distance
    result = []
    for index, meters in enumerate(positions):
        coordinate, seconds = at_distance(route, meters)
        result.append(
            {
                "id": index,
                "lat": coordinate[1],
                "lng": coordinate[0],
                "mile": meters / METERS_PER_MILE,
                "elapsed_seconds": seconds,
            }
        )
    return result


def corridor(routes):
    """At most 81 forecast cells: three cross-corridor locations per center sample."""
    cells = {}
    for route in routes:
        count = min(9, max(3, int(route["distance_meters"] / (60 * METERS_PER_MILE)) + 1))
        for index in range(count):
            (lng, lat), _ = at_distance(route, route["distance_meters"] * index / (count - 1))
            for offset in (-0.22, 0, 0.22):
                cell = {"lat": round(max(-85, min(85, lat + offset)), 3), "lng": round(lng, 3)}
                cells[(cell["lat"], cell["lng"])] = cell
    return list(cells.values())
