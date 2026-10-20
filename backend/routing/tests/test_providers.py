from unittest.mock import patch

import httpx
import pytest
from django.core.cache import cache

from routing.providers import ProviderError, RouteInputError, geocode, get_json


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()


@pytest.mark.parametrize(
    "body, guidance",
    [
        (
            {"error_code": 154, "error": "Path distance exceeds the max distance limit: 1500000 meters"},
            "1,500 km (932 mi)",
        ),
        ({"error_code": 154, "error": "Path distance exceeds the limit"}, "Choose closer cities"),
        ({"error_code": 170}, "connected by road"),
        ({"error_code": 171}, "nearby city or town"),
        ({"error_code": 441}, "connected by road"),
        ({"error_code": 442}, "connected by road"),
        ({"code": "NoRoute"}, "connected by road"),
        ({"code": "NoSegment"}, "nearby city or town"),
    ],
)
def test_known_routing_rejections_provide_actionable_input_errors(body, guidance):
    response = httpx.Response(400, json=body, request=httpx.Request("GET", "https://router.test/route"))
    with patch("routing.providers.httpx.get", return_value=response):
        with pytest.raises(RouteInputError) as error:
            get_json("https://router.test/route", routing=True)
    assert error.value.status_code == 422
    assert guidance in str(error.value)
    assert "unavailable" not in str(error.value)


@pytest.mark.parametrize(
    "status, body, routing",
    [
        (503, {"error_code": 154}, True),
        (429, {"error": "Rate limited"}, True),
        (400, {"error_code": 999}, True),
        (400, {"error_code": 154}, False),
    ],
)
def test_service_failures_are_not_misreported_as_route_input_errors(status, body, routing):
    response = httpx.Response(status, json=body, request=httpx.Request("GET", "https://provider.test/"))
    with patch("routing.providers.httpx.get", return_value=response):
        with pytest.raises(ProviderError) as error:
            get_json("https://provider.test/", routing=routing)
    assert error.value.status_code == 502
    assert "unavailable" in str(error.value)


def test_non_json_routing_failure_keeps_outage_handling():
    response = httpx.Response(
        400, text="<html>Proxy failure</html>", request=httpx.Request("GET", "https://router.test/")
    )
    with patch("routing.providers.httpx.get", return_value=response):
        with pytest.raises(ProviderError) as error:
            get_json("https://router.test/", routing=True)
    assert error.value.status_code == 502


def place(name, feature_code, region="Punjab"):
    return {
        "name": name,
        "feature_code": feature_code,
        "latitude": 31.558,
        "longitude": 74.35071,
        "country": "Pakistan",
        "admin1": region,
        "timezone": "Asia/Karachi",
    }


@pytest.mark.parametrize("name, feature_code", [("Pakistan", "PCLI"), ("Punjab", "ADM1")])
def test_country_or_region_is_not_silently_replaced_with_a_same_named_village(name, feature_code):
    rows = [place(name, feature_code), place(name, "PPL")]
    with patch("routing.providers.get_json", return_value={"results": rows}):
        with pytest.raises(RouteInputError, match="city or town"):
            geocode(name)


def test_city_and_capital_suggestions_exclude_administrative_centroids():
    rows = [place("Lahore", "PPLA"), place("Islamabad", "PPLC"), place("Punjab", "ADM1")]
    with patch("routing.providers.get_json", return_value={"results": rows}):
        results = geocode("Lahore")
    assert [result["name"] for result in results] == ["Lahore", "Islamabad"]
    assert results[0]["label"] == "Lahore, Punjab, Pakistan"


def test_qualified_city_name_still_works_when_it_also_names_a_country():
    rows = [place("China", "PCLI"), place("China", "PPL", "New York"), place("China", "PPL", "Texas")]
    with patch("routing.providers.get_json", return_value={"results": rows}):
        results = geocode("China, Texas")
    assert len(results) == 2
    assert "Texas" in results[0]["label"]
