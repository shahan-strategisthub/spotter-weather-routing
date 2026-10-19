import math

import pytest

from routing.risk import classify, recommend, summarize


@pytest.mark.parametrize(
    "wind,expected",
    [(0, 0), (24.99, 0), (25, 1), (34.99, 1), (35, 2), (44.99, 2), (45, 3), (54.99, 3), (55, 4), (80, 4)],
)
def test_wind_boundaries(wind, expected):
    assert classify(wind, 0, 0, 0)["level"] == expected


@pytest.mark.parametrize(
    "rain,expected",
    [(0, 0), (0.099, 0), (0.1, 1), (0.249, 1), (0.25, 2), (0.499, 2), (0.5, 3), (1, 3), (1.001, 4)],
)
def test_rain_boundaries(rain, expected):
    assert classify(0, rain, 0, 0)["level"] == expected


@pytest.mark.parametrize(
    "snow,expected",
    [(0, 0), (0.499, 0), (0.5, 1), (0.999, 1), (1, 2), (1.999, 2), (2, 3), (3, 3), (3.001, 4)],
)
def test_snow_boundaries(snow, expected):
    assert classify(0, 0, snow, 0)["level"] == expected


@pytest.mark.parametrize(
    "wind,load,expected",
    [
        (55, 0, 4),
        (45, 30000, 3),
        (45, 30001, 4),
        (54.99, 30001, 4),
        (35, 40000, 2),
        (35, 40001, 3),
        (44.99, 40001, 3),
        (34.99, 60000, 1),
    ],
)
def test_strict_load_thresholds(wind, load, expected):
    assert classify(wind, 0, 0, load)["level"] == expected


@pytest.mark.parametrize("value", [None, math.nan, math.inf, -1])
def test_missing_or_invalid_weather_is_unknown(value):
    assert classify(value, 0, 0, 35000)["level"] is None


def test_highest_condition_wins():
    assert classify(25, 1.1, 0, 0)["level"] == 4
    assert classify(10, 0, 2, 0)["level"] == 3


def test_risk_miles_are_conservative_and_distance_weighted():
    points = [
        {"mile": 0, "risk": {"level": 0}},
        {"mile": 10, "risk": {"level": 3}},
        {"mile": 20, "risk": {"level": 0}},
        {"mile": 23, "risk": {"level": 1}},
    ]
    summary = summarize(points, 23)
    assert summary["risk_miles"]["Severe"] == 20
    assert summary["risk_miles"]["Moderate"] == 3
    assert sum(summary["risk_miles"].values()) == 23
    assert summary["average_risk"] == pytest.approx(63 / 23)


def route(id, severe=0, high=0, average=0, duration=100, eligible=True):
    return {
        "id": id,
        "duration_seconds": duration,
        "summary": {
            "eligible": eligible,
            "risk_miles": {"Severe": severe, "High": high},
            "average_risk": average,
        },
    }


def test_lexicographic_recommendation_never_trades_severe_miles_for_speed():
    assert recommend([route("fast", severe=1, duration=1), route("safe", duration=10000)]) == "safe"
    assert recommend([route("high", high=1), route("moderate", average=1, duration=10000)]) == "moderate"
    assert recommend([route("risk", average=1), route("low", duration=10000)]) == "low"
    assert recommend([route("slow", duration=100), route("fast", duration=50)]) == "fast"


def test_no_travel_and_missing_forecasts_excluded_even_if_shortest():
    assert recommend([route("blocked", duration=1, eligible=False), route("safe")]) == "safe"
    assert recommend([route("blocked", eligible=False)]) is None
    for level in (4, None):
        assert (
            summarize([{"mile": 0, "risk": {"level": level}}, {"mile": 10, "risk": {"level": 0}}], 10)[
                "eligible"
            ]
            is False
        )


def test_missing_forecast_does_not_hide_known_no_travel():
    summary = summarize(
        [
            {"mile": 0, "risk": {"level": None}},
            {"mile": 10, "risk": {"level": 4}},
        ],
        10,
    )
    assert not summary["eligible"]
    assert summary["worst_label"] == "No Travel"
    assert summary["risk_miles"]["No Travel"] == 10
