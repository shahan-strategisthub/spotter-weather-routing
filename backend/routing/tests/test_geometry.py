from datetime import datetime, timezone

import pytest

from routing.geometry import METERS_PER_MILE, at_distance, checkpoints, normalize
from routing.planner import risk_for, weather_at
from routing.providers import ProviderError, _parse_forecast, valhalla_to_raw


def road(distance=2000):
    return normalize(
        {
            "geometry": {"coordinates": [[-87, 41], [-86.99, 41], [-86.98, 41]]},
            "distance": distance,
            "duration": 660,
            "legs": [{"annotation": {"distance": [1000, 1000], "duration": [60, 600]}}],
        }
    )


def test_eta_uses_road_duration_not_constant_speed():
    route = road()
    assert at_distance(route, 500)[1] == pytest.approx(30)
    assert at_distance(route, 1500)[1] == pytest.approx(360)
    assert at_distance(route, 2000)[1] == pytest.approx(660)


@pytest.mark.parametrize("interval", [10, 25, 50])
def test_checkpoint_spacing_includes_endpoints_and_short_tail(interval):
    route = road(103 * METERS_PER_MILE)
    points = checkpoints(route, interval)
    assert points[0]["mile"] == 0
    assert points[-1]["mile"] == pytest.approx(103)
    assert points[-1]["elapsed_seconds"] == pytest.approx(660)
    assert all(right["mile"] - left["mile"] <= interval + 1e-6 for left, right in zip(points, points[1:]))


def test_exact_spacing_does_not_duplicate_destination():
    points = checkpoints(road(100 * METERS_PER_MILE), 25)
    assert len(points) == 5
    assert points[-1]["mile"] == pytest.approx(100)


def test_hourly_forecast_uses_containing_hour_and_rejects_missing_horizon():
    forecast = {
        "times": ["2026-10-20T10:00Z", "2026-10-20T11:00Z"],
        "wind": [10, 20],
        "gust": [15, 30],
        "rain": [0, 0.2],
        "snow": [0, 0],
        "temperature": [60, 61],
    }
    exact = datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc)
    partial = datetime(2026, 10, 20, 10, 30, tzinfo=timezone.utc)
    assert weather_at(forecast, exact)["wind_mph"] == 10
    assert weather_at(forecast, partial)["wind_mph"] == 20
    assert weather_at(forecast, datetime(2026, 10, 20, 12, tzinfo=timezone.utc))["wind_mph"] is None
    assert weather_at(forecast, datetime(2026, 10, 20, 9, tzinfo=timezone.utc))["wind_mph"] is None


def test_gusts_apply_load_rules():
    assert risk_for({"wind_mph": 10, "gust_mph": 46, "rain_in": 0, "snow_in": 0}, 35000)["level"] == 4
    assert risk_for({"wind_mph": 10, "gust_mph": None, "rain_in": 0, "snow_in": 0}, 35000)["level"] is None


def test_wrong_units_are_rejected():
    with pytest.raises(ProviderError):
        _parse_forecast({"hourly_units": {"wind_speed_10m": "km/h", "rain": "mm", "snowfall": "cm"}})


def test_valhalla_geometry_and_duration_from_recorded_response():
    import json
    from pathlib import Path

    raw = json.loads((Path(__file__).parents[1] / "fixtures/chicago-detroit-valhalla.json").read_text())
    route = normalize(valhalla_to_raw(raw["trip"]))
    assert route["coordinates"][0][0] == pytest.approx(-87.63, abs=0.01)
    assert route["times"][-1] == pytest.approx(raw["trip"]["summary"]["time"])
    assert len(route["coordinates"]) == len(route["times"]) == len(route["distances"])
