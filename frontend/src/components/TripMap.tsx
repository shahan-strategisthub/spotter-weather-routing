import { memo, useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { Expand, Layers3, LoaderCircle } from 'lucide-react'
import type { Checkpoint, CorridorCell, ForecastFrame, Metric, Plan, Route } from '../types'
import { dateTime, duration, number, riskColor, ROUTE_COLORS } from '../utils'

function frameColor(frame: ForecastFrame, metric: Metric) {
  if (frame.level === null) return null
  if (metric === 'risk') return riskColor(frame.level)
  const value =
    metric === 'wind' ? frame.wind_mph : metric === 'rain' ? frame.rain_in : frame.snow_in
  if (value === null) return null
  const level =
    metric === 'wind'
      ? value >= 55
        ? 4
        : value >= 45
          ? 3
          : value >= 35
            ? 2
            : value >= 25
              ? 1
              : 0
      : metric === 'rain'
        ? value > 1
          ? 4
          : value >= 0.5
            ? 3
            : value >= 0.25
              ? 2
              : value >= 0.1
                ? 1
                : 0
        : value > 3
          ? 4
          : value >= 2
            ? 3
            : value >= 1
              ? 2
              : value >= 0.5
                ? 1
                : 0
  return riskColor(level)
}

class ForecastLayer extends L.Layer {
  private canvas = document.createElement('canvas')
  private mapRef: L.Map | null = null
  constructor(
    private cells: CorridorCell[],
    private hour: number,
    private metric: Metric,
  ) {
    super()
  }
  onAdd(map: L.Map): this {
    this.mapRef = map
    this.canvas.className = 'forecast-canvas leaflet-zoom-hide'
    map.getPane('forecast')!.appendChild(this.canvas)
    map.on('moveend zoomend resize', this.draw, this)
    this.draw()
    return this
  }
  onRemove(map: L.Map): this {
    map.off('moveend zoomend resize', this.draw, this)
    this.canvas.remove()
    this.mapRef = null
    return this
  }
  update(cells: CorridorCell[], hour: number, metric: Metric) {
    this.cells = cells
    this.hour = hour
    this.metric = metric
    this.draw()
  }
  private draw() {
    const map = this.mapRef
    if (!map) return
    const size = map.getSize(),
      ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = size.x * ratio
    this.canvas.height = size.y * ratio
    this.canvas.style.width = `${size.x}px`
    this.canvas.style.height = `${size.y}px`
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]))
    const ctx = this.canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    const radius = Math.max(
      38,
      Math.min(
        180,
        Math.abs(
          map.latLngToContainerPoint([42, -85]).x - map.latLngToContainerPoint([42, -84.3]).x,
        ),
      ),
    )
    for (const cell of this.cells) {
      const frame = cell.frames[this.hour],
        color = frame && frameColor(frame, this.metric)
      if (!color) continue
      const point = map.latLngToContainerPoint([cell.lat, cell.lng])
      if (
        point.x < -radius ||
        point.x > size.x + radius ||
        point.y < -radius ||
        point.y > size.y + radius
      )
        continue
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius)
      gradient.addColorStop(0, `${color}63`)
      gradient.addColorStop(0.45, `${color}28`)
      gradient.addColorStop(1, `${color}00`)
      ctx.fillStyle = gradient
      ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2)
    }
  }
}

function WeatherOverlay({
  cells,
  hour,
  metric,
  enabled,
}: {
  cells: CorridorCell[]
  hour: number
  metric: Metric
  enabled: boolean
}) {
  const map = useMap(),
    layer = useRef<ForecastLayer | null>(null)
  useEffect(() => {
    if (!enabled) return
    const overlay = new ForecastLayer(cells, hour, metric)
    layer.current = overlay
    overlay.addTo(map)
    return () => {
      overlay.remove()
      layer.current = null
    }
    // Frame changes update the existing canvas in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled])
  useEffect(() => {
    layer.current?.update(cells, hour, metric)
  }, [cells, hour, metric])
  return null
}

function FitTrip({ plan }: { plan: Plan }) {
  const map = useMap()
  useEffect(() => {
    const bounds = L.latLngBounds(
      plan.routes.flatMap((route) => route.geometry.map(([lng, lat]) => L.latLng(lat, lng))),
    )
    map.fitBounds(bounds, { padding: [48, 64], maxZoom: 10, animate: false })
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
    }
  }, [map, plan])
  return (
    <button
      type="button"
      className="map-fit"
      aria-label="Fit all routes on map"
      title="Fit all routes"
      onClick={() =>
        map.fitBounds(
          L.latLngBounds(
            plan.routes.flatMap((route) => route.geometry.map(([lng, lat]) => L.latLng(lat, lng))),
          ),
          { padding: [48, 64] },
        )
      }
    >
      <Expand size={17} />
    </button>
  )
}

const endpointIcon = (label: string, destination: boolean) =>
  L.divIcon({
    className: 'endpoint-icon',
    html: `<span class="endpoint-pin ${destination ? 'end' : ''}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
const originIcon = endpointIcon('A', false),
  destinationIcon = endpointIcon('B', true)

function CheckpointMarker({
  point,
  route,
  selected,
  focused,
  timezone,
  onSelect,
}: {
  point: Checkpoint
  route: Route
  selected: boolean
  focused: boolean
  timezone: string
  onSelect: (routeId: string, checkpointId: number) => void
}) {
  const marker = useRef<L.CircleMarker>(null),
    map = useMap()
  useEffect(() => {
    if (focused) {
      marker.current?.openPopup()
      map.panTo([point.lat, point.lng], { animate: false })
    }
  }, [focused, map, point.lat, point.lng])
  return (
    <CircleMarker
      ref={marker}
      center={[point.lat, point.lng]}
      radius={focused ? 8 : selected ? 5 : 3}
      pathOptions={{
        color: '#fff',
        weight: selected ? 1.8 : 1,
        fillColor: riskColor(point.risk.level),
        fillOpacity: selected ? 1 : 0.6,
        opacity: selected ? 1 : 0.6,
      }}
      eventHandlers={{ click: () => onSelect(route.id, point.id) }}
    >
      <Tooltip direction="top">
        Checkpoint {point.id + 1} · {point.risk.label} · mile {number(point.mile)}
      </Tooltip>
      <Popup>
        <div className="checkpoint-popup">
          <span className="eyebrow">
            CHECKPOINT {String(point.id + 1).padStart(2, '0')} · MILE {number(point.mile, 1)}
          </span>
          <h3>{point.risk.label} weather risk</h3>
          <p>{dateTime(point.eta, timezone)}</p>
          <dl>
            <div>
              <dt>Wind / gusts</dt>
              <dd>
                {point.weather.wind_mph ?? '—'} / {point.weather.gust_mph ?? '—'} mph
              </dd>
            </div>
            <div>
              <dt>Rain</dt>
              <dd>{point.weather.rain_in?.toFixed(2) ?? '—'} in/hr</dd>
            </div>
            <div>
              <dt>Snow</dt>
              <dd>{point.weather.snow_in?.toFixed(2) ?? '—'} in/hr</dd>
            </div>
          </dl>
          {point.risk.reasons.map((reason) => (
            <p className="popup-reason" key={reason}>
              {reason}
            </p>
          ))}
          <small>
            {route.name} · {route.eta_method}
          </small>
        </div>
      </Popup>
    </CircleMarker>
  )
}

const RouteLayers = memo(function RouteLayers({
  plan,
  selectedId,
  focusedId,
  showCheckpoints,
  onSelectRoute,
  onSelectCheckpoint,
}: {
  plan: Plan
  selectedId: string
  focusedId: number | null
  showCheckpoints: boolean
  onSelectRoute: (id: string) => void
  onSelectCheckpoint: (routeId: string, checkpointId: number) => void
}) {
  const lines = useMemo(
    () =>
      plan.routes.map((route, index) => ({
        route,
        index,
        positions: route.geometry.map(([lng, lat]) => [lat, lng] as [number, number]),
      })),
    [plan],
  )
  const ordered = [...lines].sort(
    (a, b) => Number(a.route.id === selectedId) - Number(b.route.id === selectedId),
  )
  return (
    <>
      <Pane name="routes" style={{ zIndex: 420 }}>
        {ordered.map(({ route, index, positions }) => (
          <Polyline
            key={route.id}
            positions={positions}
            pathOptions={{
              color: ROUTE_COLORS[index % 3],
              weight: route.id === selectedId ? 5 : 3.5,
              opacity: route.id === selectedId ? 1 : 0.65,
              lineCap: 'round',
            }}
            eventHandlers={{ click: () => onSelectRoute(route.id) }}
          >
            <Tooltip sticky>
              <strong>{route.name}</strong>
              <br />
              {duration(route.duration_seconds)} · {number(route.distance_miles)} mi
              <br />
              ETA {dateTime(route.arrival, plan.origin.timezone)}
              <br />
              {route.summary.worst_label} risk · Severe {number(route.summary.risk_miles.Severe, 1)}{' '}
              mi · High {number(route.summary.risk_miles.High, 1)} mi
            </Tooltip>
          </Polyline>
        ))}
      </Pane>
      {showCheckpoints &&
        ordered.flatMap(({ route }) =>
          route.checkpoints.map((point) => (
            <CheckpointMarker
              key={`${route.id}-${point.id}`}
              point={point}
              route={route}
              selected={route.id === selectedId}
              focused={route.id === selectedId && focusedId === point.id}
              timezone={plan.origin.timezone}
              onSelect={onSelectCheckpoint}
            />
          )),
        )}
      <Marker position={[plan.origin.lat, plan.origin.lng]} icon={originIcon}>
        <Tooltip permanent direction="top" offset={[0, -13]} className="city-label">
          {plan.origin.name ?? plan.origin.label.split(',')[0]}
        </Tooltip>
      </Marker>
      <Marker position={[plan.destination.lat, plan.destination.lng]} icon={destinationIcon}>
        <Tooltip permanent direction="top" offset={[0, -13]} className="city-label">
          {plan.destination.name ?? plan.destination.label.split(',')[0]}
        </Tooltip>
      </Marker>
    </>
  )
})

export default function TripMap({
  plan,
  selectedId,
  focusedId,
  hour,
  metric,
  showWeather,
  showCheckpoints,
  loading,
  onSelectRoute,
  onSelectCheckpoint,
}: {
  plan: Plan | null
  selectedId: string
  focusedId: number | null
  hour: number
  metric: Metric
  showWeather: boolean
  showCheckpoints: boolean
  loading: boolean
  onSelectRoute: (id: string) => void
  onSelectCheckpoint: (routeId: string, checkpointId: number) => void
}) {
  return (
    <div
      className={`trip-map ${loading ? 'is-loading' : ''}`}
      role="region"
      aria-label="Interactive map with route alternatives, weather and checkpoints"
    >
      <MapContainer
        center={[42.1, -85.4]}
        zoom={7}
        scrollWheelZoom={false}
        preferCanvas
        zoomControl={false}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          maxZoom={18}
        />
        <Pane name="forecast" style={{ zIndex: 350, pointerEvents: 'none' }} />
        {plan && (
          <>
            <FitTrip plan={plan} />
            <WeatherOverlay
              cells={plan.corridor}
              hour={hour}
              metric={metric}
              enabled={showWeather}
            />
            <RouteLayers
              plan={plan}
              selectedId={selectedId}
              focusedId={focusedId}
              showCheckpoints={showCheckpoints}
              onSelectRoute={onSelectRoute}
              onSelectCheckpoint={onSelectCheckpoint}
            />
          </>
        )}
        <MapZoom />
      </MapContainer>
      <div className="map-caption">
        <Layers3 size={13} />
        <span>{plan?.mode === 'demo' ? 'SAMPLE WEATHER' : 'CORRIDOR FORECAST'}</span>
        <i />
        {plan ? dateTime(plan.forecast_hours[hour], plan.origin.timezone) : 'Preparing map…'}
      </div>
      {loading && (
        <div className="map-loading">
          <LoaderCircle size={22} className="spin" />
          <div>
            <strong>Looking down the road</strong>
            <span>Comparing routes and arrival-time weather…</span>
          </div>
        </div>
      )}
    </div>
  )
}

function MapZoom() {
  const map = useMap()
  return (
    <div className="map-zoom">
      <button type="button" aria-label="Zoom in" onClick={() => map.zoomIn()}>
        +
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => map.zoomOut()}>
        −
      </button>
    </div>
  )
}
