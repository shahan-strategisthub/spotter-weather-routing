from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers


class PlaceSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-85, max_value=85)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(max_length=200)
    name = serializers.CharField(max_length=100, required=False)
    timezone = serializers.CharField(max_length=100, required=False, default="UTC")


class PlanSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.DateTimeField()
    load_lb = serializers.FloatField(min_value=0, max_value=100000)
    interval_miles = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate_departure(self, value):
        now = timezone.now()
        if value < now - timedelta(minutes=15):
            raise serializers.ValidationError("Choose a departure time in the future.")
        if value > now + timedelta(hours=48):
            raise serializers.ValidationError(
                "Choose a departure within the next 48 hours to ensure forecast coverage."
            )
        return value

    def validate(self, attrs):
        from math import isfinite

        if not isfinite(attrs["load_lb"]):
            raise serializers.ValidationError({"load_lb": "Enter a finite load weight."})
        for field in ("origin", "destination"):
            if not all(isfinite(attrs[field][axis]) for axis in ("lat", "lng")):
                raise serializers.ValidationError({field: "Enter valid finite coordinates."})
        return attrs
