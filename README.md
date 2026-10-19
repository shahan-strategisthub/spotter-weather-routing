# Corridor — Weather-aware truck routing

A React + Django application for comparing three truck routes using arrival-time weather, cargo load, and travel time. Built for the Spotter Full Stack Developer assessment.

## Run locally

Requires Python 3.12+ and Node.js 22+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python backend/manage.py collectstatic --noinput
python backend/manage.py runserver 8000
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api/` to Django. No API keys or database setup are required for the default providers.

Alternatively, start the production application with Docker:

```bash
docker compose up --build
```

Open **http://localhost:8000**. One container serves both the compiled React application and Django API through Gunicorn and WhiteNoise.

## Try it

The first view is a **clearly labeled sample trip** from Chicago to Detroit. Its three road geometries were captured from the Valhalla truck routing API; its moving weather system is synthetic so reviewers can explore meaningful risk differences without depending on current weather. Sample weather is never presented as live data.

1. Enter city names and select the correct places from the suggestions.
2. Set departure time in **your browser's local timezone**, cargo weight in pounds, and checkpoint spacing of **10, 25, or 50 miles**.
3. Choose **Find the safest route** for real routing and Open-Meteo forecasts.
4. Select route cards or map lines to compare options. Select checkpoints on the map or in the checkpoint list for weather, ETA, and risk explanations.
5. Scrub or play the **0–48 hour forecast slider** to explore the trip corridor. Switch between load-adjusted risk, wind/gusts, rain, and snow. The slider is independent of route risk, which always uses checkpoint arrival times.

Changed trip inputs leave an explicit notice until the next analysis. Provider failures preserve the previous trip with an error message; live requests never silently substitute sample data.

## Risk and recommendation logic

`backend/routing/risk.py` implements the assessment rules as pure, tested functions. A checkpoint takes the highest risk from wind, rain, and snow. Wind uses the **maximum of sustained wind and gusts**, a conservative assumption explained in the UI.

- Wind: low below 25 mph; moderate from 25; high from 35; severe from 45; no travel from 55.
- Rain: low below 0.10 in/hr; moderate from 0.10; high from 0.25; severe from 0.50 through 1.00; no travel strictly above 1.00.
- Snow: low below 0.5 in/hr; moderate from 0.5; high from 1.0; severe from 2.0 through 3.0; no travel strictly above 3.0.
- Wind from 45 to below 55 mph with cargo **over 30,000 lb** becomes no travel.
- Wind from 35 to below 45 mph with cargo **over 40,000 lb** becomes severe.

The brief shares rain/snow boundary values between adjacent bands. **Shared values use the higher band**; the specified no-travel `>` limits remain strict. The load comparisons are also strictly `>`, not `≥`.

The stretch between two checkpoints uses the **worse of their risks**. Each stretch contributes its actual mileage to a severity bucket. This handles the short final stretch correctly and makes average risk **distance weighted**, with scores 0–4 for low through no travel.

Routes with any no-travel or unknown checkpoint are **excluded from recommendation**. Eligible routes are compared lexicographically:

```text
(severe miles, high miles, distance-weighted average risk, travel time)
```

A faster route can never outweigh a route with fewer severe miles. If every route is blocked or incomplete, the application explicitly recommends **no route**.

## Routing, ETA, and weather

- **Routing:** [Valhalla](https://valhalla.github.io/valhalla/api/route/api-reference/) with its truck costing profile and two requested alternatives. If fewer than three distinct options are returned, the backend requests actual road routes through two corridor waypoints, checks geometric fingerprints, and labels their source. If the provider still cannot produce three, it reports the available count instead of inventing or duplicating routes.
- **Checkpoint placement:** interpolate at fixed cumulative road distances and include both endpoints. Valhalla maneuver travel times are interpolated within their geometry and normalized to leg totals. Optional OSRM support uses road-segment annotations when available, and explicitly labels a distance-proportional fallback when annotations are unavailable.
- **Weather:** [Open-Meteo](https://open-meteo.com/en/docs) supplies hourly sustained wind, gusts, rain, snowfall, and temperature. Requests explicitly select mph, inches, Fahrenheit, and UTC. The backend verifies returned units and array lengths.
- **Forecast timing:** use the hourly interval containing each ETA, rounding up to the next hourly timestamp when necessary. This matches the preceding-hour accumulation semantics of hourly rain/snow. Missing values and out-of-horizon forecasts remain unknown.
- **Heatmap:** up to 81 cells sample all trip corridors, including neighboring locations. All 49 hourly frames are loaded once, then rendered through a reusable Leaflet canvas layer. Slider changes make **zero API requests**. Unknown cells are omitted with a notice.
- **Performance:** deduplicate weather coordinates, batch up to 30 per request, use three bounded weather workers, cache forecasts for 15 minutes, cache routes for 30 minutes, and debounce/cancel place searches. Django compresses API responses. All routes use Leaflet's canvas renderer; the heatmap updates independently of route geometry.

Map tiles are provided by [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/), with visible attribution and normal browser caching.

## Verification

Backend tests run without external services:

```bash
source .venv/bin/activate
pytest -q
ruff check backend
ruff format --check backend
python backend/manage.py check
```

Frontend build and browser tests:

```bash
cd frontend
npm ci
npm run build
npx playwright install chromium
PYTHON_BINARY=../.venv/bin/python npm test
```

If both development servers are already running, the browser tests reuse them. In CI, the configuration starts its own Django and Vite servers using the installed Python. A locally installed Chrome can be used with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`.

Coverage includes exact weather/load boundaries, nonuniform travel times, endpoint spacing, distance-weighted miles, recommendation priority, missing forecasts, provider outages, input validation, responsive layout, keyboard place selection, checkpoint popups, playback, sample recalculation, error recovery, and core accessibility. External Leaflet-generated map markup is excluded from the automated accessibility scan; map controls and checkpoint access are also available through labeled native buttons and the checkpoint table.

GitHub Actions runs the backend checks, frontend build, and browser tests on pushes and pull requests. Browser failure traces are retained as CI artifacts.

## Deploy to Render

The repository includes a multi-stage `Dockerfile` and a [Render Blueprint](https://render.com/docs/blueprint-spec) in `render.yaml`.

1. Push this repository to your GitHub account.
2. In Render, choose **New → Blueprint**, connect the repository, and apply `render.yaml`.
3. Wait for the build and the `/api/health/` health check to pass.
4. Open the returned Render URL and run a live analysis before sharing it.

Render generates `DJANGO_SECRET_KEY`, sets production mode, and exposes its hostname through `RENDER_EXTERNAL_HOSTNAME`, which Django adds to allowed hosts. A free instance is configured; its idle startup behavior is controlled by Render. No paid services or databases are required.

For another host, use the Dockerfile and set `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, and a comma-separated `DJANGO_ALLOWED_HOSTS`. The container listens on `$PORT`, defaulting to 8000. See `.env.example` for optional provider overrides.

## API

- `GET /api/health/` — process health, without external-service dependencies.
- `GET /api/geocode/?q=Chicago` — place suggestions, including coordinates and timezone.
- `GET /api/demo/?interval_miles=25&load_lb=35000` — labeled sample trip.
- `POST /api/plan/` — live routing and forecast analysis:

```json
{
  "origin": { "label": "Chicago, Illinois", "lat": 41.8781, "lng": -87.6298, "timezone": "America/Chicago" },
  "destination": { "label": "Detroit, Michigan", "lat": 42.3314, "lng": -83.0458, "timezone": "America/Detroit" },
  "departure": "<future ISO 8601 timestamp with timezone>",
  "load_lb": 35000,
  "interval_miles": 25
}
```

Plan requests are limited to 8 per minute per anonymous client; other endpoints use 90 per minute. Input validation runs before external requests. All datetime values in API responses are UTC; route summaries and checkpoints are displayed in the origin's timezone.

## Structure

```text
backend/
  config/             Django settings, URLs, WSGI, SPA delivery
  routing/
    geometry.py       Cumulative distance and duration interpolation
    providers.py      Valhalla/OSRM, geocoding, weather, bounded batching/cache
    risk.py           Weather/load classification and route ranking
    planner.py        Arrival-time weather, summaries, 49 heatmap frames
    serializers.py    Request validation
    views.py          API endpoints and error handling
    demo.py           Recorded routes + explicitly synthetic weather
    tests/            Deterministic rule, geometry, and API tests
frontend/
  src/components/     Place search, route cards, map/canvas, methodology dialog
  src/App.tsx         Trip workflow and state
  tests/              Browser and accessibility checks
docs/WALKTHROUGH.md   Timed 5–10 minute presentation guide
```

## Assumptions and limits

- This is a weather planning assessment, not turn-by-turn navigation. Valhalla uses its default truck dimensions and gross-weight profile; entered **cargo** weight affects weather risk only. It cannot stand in for total vehicle weight or a complete vehicle specification.
- ETAs exclude driver rest breaks, closures, and live traffic. A production fleet product would add these to checkpoint timings.
- Geocoding searches named places, not arbitrary street addresses. Departure must be within 48 hours; weather is requested for seven days. Any ETA outside that window is unknown and ineligible.
- Three **distinct** drivable routes are not geographically guaranteed. Waypoint routes can be longer; their true travel times and risk are included in the comparison.
- Sparse weather sampling and smooth heatmap interpolation cannot establish conditions between every two points. The endpoint maximum is a documented conservative approximation.
- Public routing, forecast, and tile services have availability and usage limits. A production deployment should use contracted capacity or a self-hosted router. Process-local caches/rate limits are appropriate for this assessment; a shared Redis backend would coordinate multiple workers.
- Anonymous, stateless planning needs no user database or account. No trip history, fleet management, or unrelated features were added.

## Submission

Submit the GitHub repository URL, verified hosted application URL, and a **5–10 minute Loom recording**. Use [the walkthrough guide](docs/WALKTHROUGH.md) to demonstrate the app and explain the rules and tradeoffs. Record the walkthrough in your own voice and verify that all three links are accessible to the reviewer.
