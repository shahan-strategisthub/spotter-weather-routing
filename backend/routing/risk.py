"""Assessment rules, independent of Django and API providers. All units are imperial."""

from enum import IntEnum
from math import isfinite


class Level(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4


LABELS = ["Low", "Moderate", "High", "Severe", "No Travel"]


def classify(wind_mph, rain_in, snow_in, load_lb):
    if any(value is None or not isfinite(value) or value < 0 for value in (wind_mph, rain_in, snow_in)):
        return {
            "level": None,
            "label": "Unknown",
            "reasons": ["Forecast unavailable; route cannot be recommended."],
        }
    wind = (
        Level.NO_TRAVEL
        if wind_mph >= 55
        else Level.SEVERE
        if wind_mph >= 45
        else Level.HIGH
        if wind_mph >= 35
        else Level.MODERATE
        if wind_mph >= 25
        else Level.LOW
    )
    # Shared boundaries go to the higher risk band. The no-travel bounds are strict.
    rain = (
        Level.NO_TRAVEL
        if rain_in > 1
        else Level.SEVERE
        if rain_in >= 0.5
        else Level.HIGH
        if rain_in >= 0.25
        else Level.MODERATE
        if rain_in >= 0.1
        else Level.LOW
    )
    snow = (
        Level.NO_TRAVEL
        if snow_in > 3
        else Level.SEVERE
        if snow_in >= 2
        else Level.HIGH
        if snow_in >= 1
        else Level.MODERATE
        if snow_in >= 0.5
        else Level.LOW
    )
    reasons = []
    if wind_mph >= 55:
        reasons.append("Wind ≥55 mph: no travel at any load.")
    elif wind_mph >= 45 and load_lb > 30000:
        wind = Level.NO_TRAVEL
        reasons.append("Wind ≥45 mph with a load over 30,000 lb: no travel.")
    elif wind_mph >= 35 and load_lb > 40000:
        wind = max(wind, Level.SEVERE)
        reasons.append("Wind ≥35 mph with a load over 40,000 lb: severe risk.")
    if not reasons and wind > Level.LOW:
        reasons.append(f"Wind / gusts {wind_mph:.1f} mph: {LABELS[wind].lower()} risk.")
    if rain > Level.LOW:
        reasons.append(f"Rain {rain_in:.2f} in/hr: {LABELS[rain].lower()} risk.")
    if snow > Level.LOW:
        reasons.append(f"Snow {snow_in:.2f} in/hr: {LABELS[snow].lower()} risk.")
    level = max(wind, rain, snow)
    return {
        "level": int(level),
        "label": LABELS[level],
        "reasons": reasons or ["Weather is within low-risk thresholds."],
    }


def summarize(checkpoints, total_miles):
    miles = {label: 0.0 for label in [*LABELS, "Unknown"]}
    weighted = 0.0
    for left, right in zip(checkpoints, checkpoints[1:]):
        distance = max(0, right["mile"] - left["mile"])
        levels = [left["risk"]["level"], right["risk"]["level"]]
        # A known no-travel endpoint still blocks a stretch with a missing forecast.
        level = Level.NO_TRAVEL if Level.NO_TRAVEL in levels else None if None in levels else max(levels)
        miles["Unknown" if level is None else LABELS[level]] += distance
        weighted += (4 if level is None else level) * distance
    worst = max((cp["risk"]["level"] for cp in checkpoints if cp["risk"]["level"] is not None), default=0)
    unknown = any(cp["risk"]["level"] is None for cp in checkpoints)
    blocked = any(cp["risk"]["level"] == Level.NO_TRAVEL for cp in checkpoints)
    return {
        "risk_miles": miles,
        "average_risk": weighted / total_miles if total_miles else 0,
        "worst_level": int(Level.NO_TRAVEL) if blocked else None if unknown else worst,
        "worst_label": LABELS[Level.NO_TRAVEL] if blocked else "Unknown" if unknown else LABELS[worst],
        "eligible": not blocked and not unknown,
    }


def recommend(routes):
    eligible = [route for route in routes if route["summary"]["eligible"]]
    if not eligible:
        return None
    # Lexicographic comparison: travel time can never outweigh severe/high miles.
    return min(
        eligible,
        key=lambda route: (
            route["summary"]["risk_miles"]["Severe"],
            route["summary"]["risk_miles"]["High"],
            route["summary"]["average_risk"],
            route["duration_seconds"],
        ),
    )["id"]
