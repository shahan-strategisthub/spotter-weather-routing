from datetime import timedelta
from unittest.mock import patch

import httpx
import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from routing.demo import DESTINATION, ORIGIN, demo_routes
from routing.providers import ProviderError


@pytest.fixture
def client():
    from django.core.cache import cache

    cache.clear()
    return APIClient()


def payload(**changes):
    return {
        "origin": ORIGIN,
        "destination": DESTINATION,
        "departure": (timezone.now() + timedelta(hours=1)).isoformat(),
        "load_lb": 35000,
        "interval_miles": 25,
        **changes,
    }


def test_demo_complete_and_explicitly_labeled(client):
    response = client.get("/api/demo/")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "demo"
    assert len(data["routes"]) == 3
    assert len(data["forecast_hours"]) == 49
    assert all(len(cell["frames"]) == 49 for cell in data["corridor"])
    assert "Synthetic" in data["providers"]["weather"]
    assert data["recommended_route_id"] in [route["id"] for route in data["routes"]]
    for route in data["routes"]:
        assert sum(route["summary"]["risk_miles"].values()) == pytest.approx(route["distance_miles"])
        assert route["checkpoints"][-1]["eta"] == route["arrival"]


@pytest.mark.parametrize(
    "changes",
    [
        {"load_lb": -1},
        {"load_lb": 100001},
        {"load_lb": "NaN"},
        {"interval_miles": 20},
        {"departure": (timezone.now() - timedelta(days=1)).isoformat()},
        {"departure": (timezone.now() + timedelta(days=3)).isoformat()},
        {"origin": {"lat": 999, "lng": 0, "label": "Invalid"}},
    ],
)
def test_invalid_requests_are_rejected_before_provider_calls(client, changes):
    with patch("routing.views.route_options") as provider:
        assert client.post("/api/plan/", payload(**changes), format="json").status_code == 400
        provider.assert_not_called()


def test_routing_outage_returns_error_instead_of_demo_disguised_as_live(client):
    with patch("routing.views.route_options", side_effect=ProviderError("Routing unavailable")):
        response = client.post("/api/plan/", payload(), format="json")
    assert response.status_code == 502
    assert response.json()["error"] == "Routing unavailable"


def test_router_distance_rejection_returns_422_before_weather_analysis(client):
    upstream = httpx.Response(
        400,
        json={"error_code": 154, "error": "Path distance exceeds the max distance limit: 1500000 meters"},
        request=httpx.Request("GET", "https://router.test/route"),
    )
    with patch("routing.providers.httpx.get", return_value=upstream), patch("routing.views.plan") as planner:
        response = client.post("/api/plan/", payload(), format="json")
    assert response.status_code == 422
    assert "1,500 km (932 mi)" in response.json()["error"]
    planner.assert_not_called()


def test_country_search_returns_city_guidance(client):
    with patch(
        "routing.providers.get_json",
        return_value={"results": [{"name": "Pakistan", "feature_code": "PCLI"}]},
    ):
        response = client.get("/api/geocode/?q=Pakistan")
    assert response.status_code == 422
    assert "city or town" in response.json()["error"]


def test_weather_outage_marks_all_routes_ineligible(client):
    with (
        patch("routing.views.route_options", return_value=demo_routes()),
        patch("routing.providers.weather_forecasts", return_value={}),
    ):
        # The planner's default argument is bound at import; patch the batch loader's dependency.
        with patch("routing.providers.get_json", side_effect=ProviderError("Weather unavailable")):
            response = client.post("/api/plan/", payload(), format="json")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "live"
    assert data["recommended_route_id"] is None
    assert all(not route["summary"]["eligible"] for route in data["routes"])
    assert data["warnings"]


def test_sample_spacing_and_load_can_be_changed(client):
    data = client.get("/api/demo/?interval_miles=10&load_lb=45000").json()
    assert data["interval_miles"] == 10
    assert data["load_lb"] == 45000
    assert len(data["routes"][0]["checkpoints"]) > 25


def test_health(client):
    assert client.get("/api/health/").json()["status"] == "ok"
