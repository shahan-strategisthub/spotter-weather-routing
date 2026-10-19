# Loom walkthrough — target 7–8 minutes

Open the hosted application and repository in separate tabs before recording. Use a 1440×900 or larger browser window and enlarge the page if needed for readable text. Disable notifications. Rehearse once, then record the walkthrough in your own voice. Replace any example narration with wording that accurately reflects your understanding.

## 0:00–0:40 — Introduce the application

Show the planner with the sample trip loaded.

“This is Corridor, a React and Django application for weather-aware truck route planning. It compares three road routes using weather at the truck's estimated arrival time, cargo weight, and travel time. The main focus is getting the risk and recommendation rules right while keeping route comparison and forecast exploration responsive.”

Point out the **Sample trip** badge and synthetic-weather notice. Explain that the geometry is from actual Valhalla truck routes, while sample weather is synthetic so a reviewer can reliably see different risk bands. Live analysis uses real weather.

## 0:40–1:40 — Run a live trip

Keep Chicago to Detroit or search for another road-connected city pair. Select results from the place suggestions. Show departure time, the browser timezone label, a 35,000 lb load, and the 25 mile spacing option. Click **Find the safest route**.

“Departure is entered in the browser's local timezone and sent to Django as UTC. Route ETAs are displayed in the origin's timezone. The backend requests alternatives from Valhalla's truck profile. If it gets fewer than three, it requests real routed alternatives through neighboring corridor waypoints and removes duplicate geometries.”

Show the live forecast badge and the route cards. Point out distance, travel time, ETA, risk distribution, and severe/high mileage. If live weather is all low risk, explain that the shortest travel time correctly wins after the preceding safety criteria tie.

## 1:40–2:40 — Explore checkpoints

Select a route card and click one of its map checkpoints. Then use a checkpoint table arrow to focus another point.

“Checkpoint spacing is measured along the road geometry. Each ETA comes from cumulative maneuver travel times rather than treating every part of the trip as the same speed. The forecast for that checkpoint uses its own arrival hour. The popup shows sustained wind, gusts, hourly rain and snow, and the explanation for the resulting risk.”

Point out the final checkpoint and its shorter final interval. Show the high/severe filter if there are elevated conditions; otherwise use the sample trip in the next segment.

## 2:40–3:40 — Show the forecast heatmap

Move the slider to +12, +24, and +48 hours. Switch the metric from weather risk to wind/gusts, rainfall, and snowfall. Play and pause the forecast. Toggle the weather layer and checkpoint markers.

“The weather layer samples the trip corridor and neighboring locations. Django returns all 49 forecast frames in the first response, so scrubbing and playback render locally without new API requests. The heatmap uses a reusable Leaflet canvas layer. Route geometries stay separate from forecast rendering.”

“The slider explores weather at departure plus an offset. It does not change the route recommendation, which remains based on each checkpoint's ETA. To compare a different departure, change the form and rerun the analysis.”

## 3:40–4:50 — Explain risk and recommendation

Open **How it works**. Show the rule table and load conditions.

“A checkpoint uses the highest risk among wind, rain, and snow. I use the greater of wind and gusts. At 55 mph, no load can travel. At 45 mph and a cargo load over 30,000 pounds, the result is also no travel. From 35 mph, a load over 40,000 pounds becomes severe.”

“The brief overlaps the rain and snow boundaries. I consistently put shared values into the higher risk band, while retaining the explicit strict no-travel limits above one inch of rain and three inches of snow.”

Close the dialog. Use **Explore sample trip** to show differing risks.

“Each stretch uses the worse risk of its endpoint checkpoints. I accumulate actual miles in each band and calculate a distance-weighted average. Any no-travel or unknown checkpoint excludes the route. The remaining routes are compared by severe miles, then high miles, then average risk, and only then travel time. This is a lexicographic comparison, so a shorter ETA cannot compensate for more severe miles.”

## 4:50–6:10 — Show the implementation and tests

Switch to the repository. Open these files without reading every line:

1. `backend/routing/risk.py`: classification, strict load rules, risk-mile summary, and `recommend`.
2. `backend/routing/geometry.py`: cumulative-distance checkpoint placement and time interpolation.
3. `backend/routing/planner.py`: forecast lookup using each checkpoint ETA and generation of 49 heatmap frames.
4. `frontend/src/components/TripMap.tsx`: the persistent canvas layer and separate route layers.

Show test results from a real recent run:

```bash
pytest -q
cd frontend
npm test
```

“Tests cover exact boundaries, strict load comparisons, nonuniform route timings, the final partial interval, risk-mile weighting, recommendation order, and missing data. Browser tests cover route selection, checkpoint popups, keyboard place search, the responsive layout, the slider's zero-request behavior, and provider error recovery.”

## 6:10–7:10 — Discuss reliability and scope

Show the README and Dockerfile/Render Blueprint.

“The app is served as one Docker container: React is compiled at build time, and Django serves the API and static frontend. The default APIs need no keys. Weather coordinates are deduplicated and batched, with bounded concurrency and caches. Place search is debounced and canceled. If a provider fails, the app reports it, and missing weather never becomes low risk.”

“The entered weight is cargo weight, so it only modifies the weather rules. The router uses its default truck profile. I have documented that rest breaks and live traffic are not included in ETA calculations. A production product would add vehicle specifications, traffic and hours-of-service constraints, contracted data capacity, and shared caching.”

## 7:10–7:40 — Finish with the working app

Return to the hosted application. Briefly show a narrow/mobile viewport if time permits. Show that editing load or spacing displays the “details changed” notice until recalculation.

“The repository includes setup instructions, the risk assumptions, API behavior, deployment configuration, and a repeatable test suite. The application prioritizes the assessment's core routing and weather behavior without adding unrelated features.”

End the recording and check its duration, playback, and share permissions. Submit the actual repository, hosted application, and Loom URLs. Do not substitute the local development URL for the hosted application.
