import logging
from datetime import datetime, timedelta, timezone

from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .planner import plan
from .providers import ProviderError, geocode, route_options
from .serializers import PlanSerializer

logger = logging.getLogger(__name__)


def health(request):
    return JsonResponse({"status": "ok", "service": "corridor"})


class PlanThrottle(AnonRateThrottle):
    scope = "plan"


class GeocodeView(APIView):
    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if not 2 <= len(query) <= 100:
            return Response({"error": "Enter a place name between 2 and 100 characters."}, status=400)
        try:
            return Response({"results": geocode(query)})
        except ProviderError as exc:
            return Response({"error": str(exc)}, status=502)


class PlanView(APIView):
    throttle_classes = [PlanThrottle]

    def post(self, request):
        serializer = PlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            routes = route_options(data["origin"], data["destination"])
            return Response(
                plan(
                    routes,
                    data["departure"],
                    data["load_lb"],
                    data["interval_miles"],
                    data["origin"],
                    data["destination"],
                )
            )
        except ProviderError as exc:
            return Response({"error": str(exc)}, status=502)
        except (KeyError, ValueError, TypeError, IndexError):
            logger.exception("Invalid route provider response")
            return Response(
                {"error": "The routing service returned incomplete route data. Please try again."}, status=502
            )


class DemoView(APIView):
    def get(self, request):
        from .demo import DESTINATION, ORIGIN, demo_forecasts, demo_routes

        try:
            interval = int(request.query_params.get("interval_miles", 25))
            load = float(request.query_params.get("load_lb", 35000))
        except ValueError:
            return Response({"error": "Invalid sample trip parameters."}, status=400)
        from math import isfinite

        if interval not in (10, 25, 50) or not isfinite(load) or not 0 <= load <= 100000:
            return Response(
                {"error": "Choose a 10, 25, or 50 mile interval and a load from 0 to 100,000 lb."}, status=400
            )
        departure = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        return Response(
            plan(
                demo_routes(),
                departure,
                load,
                interval,
                ORIGIN,
                DESTINATION,
                forecast_loader=demo_forecasts,
                mode="demo",
            )
        )
