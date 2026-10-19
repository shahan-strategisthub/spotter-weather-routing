from pathlib import Path

from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.urls import path, re_path
from routing.views import DemoView, GeocodeView, PlanView, health


def frontend(request):
    index = Path(settings.WHITENOISE_ROOT) / "index.html"
    if not index.exists():
        return JsonResponse(
            {
                "message": "Build the React frontend with npm run build, or use the Vite dev server on port 5173."
            },
            status=503,
        )
    return FileResponse(index.open("rb"), content_type="text/html")


urlpatterns = [
    path("api/health/", health),
    path("api/geocode/", GeocodeView.as_view()),
    path("api/plan/", PlanView.as_view()),
    path("api/demo/", DemoView.as_view()),
    re_path(r"^(?!api/).*$", frontend),
]
