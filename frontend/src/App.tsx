import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownUp,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CloudSun,
  Compass,
  Info,
  LoaderCircle,
  MapPin,
  Navigation,
  Pause,
  Play,
  Route as RouteIcon,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Weight,
  Wind,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import PlaceInput from './components/PlaceInput'
import RouteCard from './components/RouteCard'
import RulesDialog from './components/RulesDialog'
import TripMap from './components/TripMap'
import type { Metric, Place, Plan } from './types'
import {
  dateTime,
  duration,
  localInput,
  number,
  request,
  riskColor,
  RISK_LABELS,
  time,
} from './utils'

const ORIGIN: Place = {
  name: 'Chicago',
  label: 'Chicago, Illinois, United States',
  lat: 41.8781,
  lng: -87.6298,
  timezone: 'America/Chicago',
}
const DESTINATION: Place = {
  name: 'Detroit',
  label: 'Detroit, Michigan, United States',
  lat: 42.3314,
  lng: -83.0458,
  timezone: 'America/Detroit',
}

function Roadmark() {
  return (
    <svg width="31" height="32" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M6 31V17a12 12 0 0 1 24 0v14h-8V17a4 4 0 0 0-8 0v14H6Z" fill="currentColor" />
      <path
        d="M18 25v6M18 15v5M17.5 9h1"
        stroke="#143d32"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function App() {
  const [origin, setOrigin] = useState<Place | null>(ORIGIN),
    [destination, setDestination] = useState<Place | null>(DESTINATION)
  const [departure, setDeparture] = useState(localInput(new Date(Date.now() + 3600_000)))
  const [load, setLoad] = useState('35000'),
    [interval, setIntervalMiles] = useState(25)
  const [plan, setPlan] = useState<Plan | null>(null),
    [selectedId, setSelectedId] = useState(''),
    [focusedId, setFocusedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false)
  const [hour, setHour] = useState(0),
    [playing, setPlaying] = useState(false),
    [metric, setMetric] = useState<Metric>('risk')
  const [showWeather, setShowWeather] = useState(true),
    [showCheckpoints, setShowCheckpoints] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false),
    [checkpointFilter, setCheckpointFilter] = useState('all')
  const formRef = useRef<HTMLFormElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const selectedRoute = plan?.routes.find((route) => route.id === selectedId) ?? plan?.routes[0]
  const originZone = plan?.origin.timezone ?? 'UTC'
  const localZone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')?.value

  const adopt = useCallback((data: Plan) => {
    setPlan(data)
    setSelectedId(data.recommended_route_id ?? data.routes[0]?.id ?? '')
    setFocusedId(null)
    setHour(0)
    setPlaying(false)
    setDirty(false)
    setCheckpointFilter('all')
    setOrigin(data.origin)
    setDestination(data.destination)
    setDeparture(localInput(new Date(data.departure)))
    setLoad(String(data.load_lb))
    setIntervalMiles(data.interval_miles)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current = controller
    request<Plan>('/api/demo/', { signal: controller.signal })
      .then(adopt)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load the sample trip.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [adopt])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setHour((value) => (value >= 48 ? 0 : value + 1)), 650)
    return () => window.clearInterval(timer)
  }, [playing])

  async function analyze(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!origin || !destination) {
      setError('Select an origin and destination from the search suggestions.')
      return
    }
    if (!departure || !load || !Number.isFinite(Number(load))) {
      setError('Enter a departure time and valid load weight.')
      return
    }
    const controller = new AbortController()
    activeRequest.current?.abort()
    activeRequest.current = controller
    setLoading(true)
    setPlaying(false)
    try {
      adopt(
        await request<Plan>('/api/plan/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin,
            destination,
            departure: new Date(departure).toISOString(),
            load_lb: Number(load),
            interval_miles: interval,
          }),
          signal: controller.signal,
        }),
      )
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Route analysis failed. Please try again.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  async function sampleTrip() {
    const controller = new AbortController()
    activeRequest.current?.abort()
    activeRequest.current = controller
    setLoading(true)
    setError('')
    setPlaying(false)
    try {
      adopt(
        await request<Plan>(`/api/demo/?interval_miles=${interval}&load_lb=${Number(load) || 0}`, {
          signal: controller.signal,
        }),
      )
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Sample trip unavailable.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  const selectRoute = useCallback((id: string) => {
    setSelectedId(id)
    setFocusedId(null)
    setCheckpointFilter('all')
  }, [])
  const selectCheckpoint = useCallback((routeId: string, checkpointId: number) => {
    setSelectedId(routeId)
    setFocusedId(checkpointId)
    setShowCheckpoints(true)
  }, [])
  const visibleCheckpoints =
    selectedRoute?.checkpoints.filter(
      (point) =>
        checkpointFilter === 'all' ||
        (checkpointFilter === 'elevated'
          ? point.risk.level !== null && point.risk.level >= 2
          : point.risk.level === null || point.risk.level === 4),
    ) ?? []

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="Primary navigation">
        <a href="#main" className="rail-logo" aria-label="Corridor route planner">
          <Roadmark />
        </a>
        <div className="rail-divider" />
        <button
          className="rail-item active"
          title="Route planner"
          aria-label="Focus route planner"
          onClick={() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            formRef.current?.querySelector('input')?.focus()
          }}
        >
          <RouteIcon size={22} />
          <span className="rail-active-dot" />
        </button>
        <button
          className="rail-item"
          title="Weather and risk rules"
          aria-label="Weather and risk rules"
          onClick={() => setRulesOpen(true)}
        >
          <ShieldCheck size={21} />
        </button>
        <div className="rail-bottom">
          <button
            className="rail-item"
            title="How Corridor works"
            aria-label="How Corridor works"
            onClick={() => setRulesOpen(true)}
          >
            <CircleHelp size={21} />
          </button>
          <span className="rail-initials" title="Driver workspace">
            DR
          </span>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <a className="wordmark" href="#main">
            corridor
          </a>
          <div className="header-divider" />
          <span className="header-subtitle">Weather-aware routing</span>
          <div className="header-right">
            <span className="workspace-status">
              <i />
              Driver workspace
            </span>
            <span className="imperial-label">US / IMPERIAL</span>
            <button
              className="header-help"
              aria-label="How it works"
              onClick={() => setRulesOpen(true)}
            >
              <Info size={15} />
              <span>How it works</span>
            </button>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">
                <Compass size={13} /> ROUTE INTELLIGENCE <span>/</span> TRIP PLANNER
              </div>
              <h1>
                A clearer road ahead<span>.</span>
              </h1>
              <p>Plan your trip around the weather, not through it.</p>
            </div>
            <button className="sample-button" disabled={loading} onClick={sampleTrip}>
              <CloudSun size={17} />
              Explore sample trip
              <ArrowUpRightIcon />
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <Info size={18} />
              <div>
                <strong>We couldn’t complete the analysis.</strong>
                <p>
                  {error}
                  {plan ? ' The previous trip remains displayed below.' : ''}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="planner-grid">
            <aside className="planner-sidebar">
              <section className="panel trip-panel">
                <div className="panel-title">
                  <span className="section-icon">
                    <Navigation size={19} />
                  </span>
                  <div>
                    <h2>Your trip</h2>
                    <p>Good decisions start here.</p>
                  </div>
                  <span className="step-number">01</span>
                </div>
                <form ref={formRef} onSubmit={analyze}>
                  <fieldset disabled={loading}>
                    <div className="journey-fields">
                      <PlaceInput
                        label="Origin"
                        kind="origin"
                        value={origin}
                        onChange={(value) => {
                          setOrigin(value)
                          setDirty(true)
                        }}
                      />
                      <span className="journey-line" aria-hidden="true" />
                      <button
                        type="button"
                        className="swap-button"
                        aria-label="Swap origin and destination"
                        onClick={() => {
                          setOrigin(destination)
                          setDestination(origin)
                          setDirty(true)
                        }}
                      >
                        <ArrowDownUp size={14} />
                      </button>
                      <PlaceInput
                        label="Destination"
                        kind="destination"
                        value={destination}
                        onChange={(value) => {
                          setDestination(value)
                          setDirty(true)
                        }}
                      />
                    </div>
                    <p className="field-hint">
                      Choose cities or towns from the search suggestions.
                    </p>
                    <div className="field-group">
                      <label htmlFor="departure">
                        Departure <span>{localZone} · your local time</span>
                      </label>
                      <div className="input-with-icon">
                        <CalendarDays size={17} />
                        <input
                          id="departure"
                          type="datetime-local"
                          value={departure}
                          min={localInput(new Date(Date.now() - 15 * 60_000))}
                          max={localInput(new Date(Date.now() + 48 * 3600_000))}
                          required
                          onChange={(e) => {
                            setDeparture(e.target.value)
                            setDirty(true)
                          }}
                        />
                      </div>
                    </div>
                    <div className="field-group">
                      <label htmlFor="load">Load weight</label>
                      <div className="input-with-icon">
                        <Weight size={17} />
                        <input
                          id="load"
                          type="number"
                          min="0"
                          max="100000"
                          step="1"
                          value={load}
                          required
                          onChange={(e) => {
                            setLoad(e.target.value)
                            setDirty(true)
                          }}
                        />
                        <span className="input-suffix">lb</span>
                      </div>
                      <p className="field-hint">Heavier loads change wind risk thresholds.</p>
                    </div>
                    <div className="field-group sampling-field">
                      <label>
                        Checkpoint spacing{' '}
                        <Info
                          size={13}
                          aria-label="Weather is checked at each checkpoint's estimated arrival time"
                        />
                      </label>
                      <div
                        className="segmented-control"
                        role="group"
                        aria-label="Checkpoint spacing"
                      >
                        {[10, 25, 50].map((miles) => (
                          <button
                            key={miles}
                            type="button"
                            className={interval === miles ? 'active' : ''}
                            aria-pressed={interval === miles}
                            onClick={() => {
                              setIntervalMiles(miles)
                              setDirty(true)
                            }}
                          >
                            {miles}
                            <span> miles</span>
                            {interval === miles && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                      <div className="sampling-captions">
                        <span>More detail</span>
                        <span>Faster analysis</span>
                      </div>
                    </div>
                    <button className="analyze-button" type="submit">
                      {loading ? (
                        <>
                          <LoaderCircle size={18} className="spin" />
                          Analyzing your trip…
                        </>
                      ) : (
                        <>
                          <RouteIcon size={18} />
                          Find the safest route
                          <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                  </fieldset>
                </form>
                <div className="form-footer">
                  <ShieldCheck size={13} />
                  Weather at your ETA. Risk for your load.
                </div>
              </section>
              <section className="decision-note">
                <div className="decision-note-icon">
                  <Truck size={21} />
                </div>
                <h3>Safety has the right of way.</h3>
                <p>We prioritize fewer severe and high-risk miles. Travel time breaks the tie.</p>
                <button onClick={() => setRulesOpen(true)}>
                  See the risk rules
                  <ArrowRight size={13} />
                </button>
              </section>
            </aside>
            <section className="route-workspace" aria-label="Trip analysis">
              <div className="map-panel panel">
                <div className="map-toolbar">
                  <div>
                    <span className="live-indicator" />
                    <h2>Route overview</h2>
                    {plan && (
                      <span className={`data-badge ${plan.mode}`}>
                        {plan.mode === 'demo' ? 'Sample trip' : 'Live forecast'}
                      </span>
                    )}
                  </div>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={showCheckpoints}
                      onChange={(e) => setShowCheckpoints(e.target.checked)}
                    />
                    <span className="toggle-track" />
                    Checkpoints
                  </label>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={showWeather}
                      onChange={(e) => setShowWeather(e.target.checked)}
                    />
                    <span className="toggle-track" />
                    Weather
                  </label>
                </div>
                <TripMap
                  plan={plan}
                  selectedId={selectedId}
                  focusedId={focusedId}
                  hour={hour}
                  metric={metric}
                  showWeather={showWeather}
                  showCheckpoints={showCheckpoints}
                  loading={loading}
                  onSelectRoute={selectRoute}
                  onSelectCheckpoint={selectCheckpoint}
                />
                <div className="forecast-controls">
                  <div className="forecast-control-top">
                    <div>
                      <span className="forecast-label">
                        <CloudSun size={17} />
                        CORRIDOR FORECAST
                      </span>
                      <span className="forecast-relative">
                        {hour === 0 ? 'At departure' : `Departure + ${hour}h`}
                      </span>
                    </div>
                    <div className="metric-select">
                      <select
                        aria-label="Weather heatmap metric"
                        value={metric}
                        onChange={(e) => setMetric(e.target.value as Metric)}
                      >
                        <option value="risk">Weather risk</option>
                        <option value="wind">Wind & gusts</option>
                        <option value="rain">Rainfall</option>
                        <option value="snow">Snowfall</option>
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </div>
                  <div className="forecast-slider-row">
                    <button
                      className={`play-button ${playing ? 'playing' : ''}`}
                      aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
                      disabled={!plan}
                      onClick={() => setPlaying((value) => !value)}
                    >
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <div className="slider-wrap">
                      <input
                        aria-label="Forecast hours after departure"
                        type="range"
                        min="0"
                        max="48"
                        step="1"
                        value={hour}
                        disabled={!plan}
                        onChange={(e) => {
                          setHour(Number(e.target.value))
                          setPlaying(false)
                        }}
                        style={
                          { '--slider-progress': `${(hour / 48) * 100}%` } as React.CSSProperties
                        }
                      />
                      <div className="slider-ticks">
                        {[0, 12, 24, 36, 48].map((value) => (
                          <span key={value}>{value === 0 ? 'Departure' : `+${value}h`}</span>
                        ))}
                      </div>
                    </div>
                    <span className="forecast-hour">
                      {String(hour).padStart(2, '0')}
                      <small>h</small>
                    </span>
                  </div>
                  <div className="map-legend">
                    {RISK_LABELS.map((label, index) => (
                      <span key={label}>
                        <i style={{ background: riskColor(index as 0 | 1 | 2 | 3 | 4) }} />
                        {label}
                      </span>
                    ))}
                    <span>
                      <i className="unknown-dot" />
                      Unknown
                    </span>
                  </div>
                  <p className="forecast-footnote">
                    {metric === 'risk'
                      ? 'Heatmap includes load rules.'
                      : `${metric === 'wind' ? 'Wind uses the greater of wind and gusts (mph).' : metric === 'rain' ? 'Rainfall shown in inches per hour.' : 'Snowfall shown in inches per hour.'}`}{' '}
                    Route risk always uses each checkpoint’s arrival time.
                  </p>
                </div>
              </div>
              {plan?.mode === 'demo' && (
                <div className="sample-note">
                  <Info size={14} />
                  <span>
                    Sample trip: real truck routes with synthetic weather. Select{' '}
                    <strong>Find the safest route</strong> for a live forecast.
                  </span>
                </div>
              )}
              {dirty && plan && (
                <div className="alert pending">
                  <SlidersHorizontal size={16} />
                  <span>Trip details changed. Run a new analysis to update the routes.</span>
                </div>
              )}
              {plan && (
                <>
                  <div className="routes-section-heading">
                    <div>
                      <h2>
                        Your route options<span>{plan.routes.length}</span>
                      </h2>
                      <p>
                        {number(plan.load_lb)} lb load · Every {plan.interval_miles} miles ·{' '}
                        {dateTime(plan.departure, originZone)}
                      </p>
                    </div>
                    <span className="arrival-label">
                      <Clock3 size={13} />
                      Times in origin timezone
                    </span>
                  </div>
                  <div className="route-cards">
                    {plan.routes.map((route, index) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        index={index}
                        selected={selectedId === route.id}
                        recommended={plan.recommended_route_id === route.id}
                        timezone={originZone}
                        onSelect={() => selectRoute(route.id)}
                      />
                    ))}
                  </div>
                  <div
                    className={`recommendation-explanation ${!plan.recommended_route_id ? 'no-recommendation' : ''}`}
                  >
                    <ShieldCheck size={17} />
                    <span>{plan.recommendation_reason}</span>
                  </div>
                  {plan.warnings.map((warning) => (
                    <div className="alert warning" key={warning}>
                      <Info size={16} />
                      <span>{warning}</span>
                    </div>
                  ))}
                </>
              )}
            </section>
          </div>
          {plan && selectedRoute && (
            <section className="panel checkpoint-section">
              <div className="checkpoint-heading">
                <div>
                  <div className="eyebrow">
                    <MapPin size={12} /> ALONG YOUR ROUTE
                  </div>
                  <h2>Every checkpoint, accounted for.</h2>
                  <p>
                    {selectedRoute.name} · {duration(selectedRoute.duration_seconds)} ·{' '}
                    {number(selectedRoute.distance_miles)} miles
                  </p>
                </div>
                <div className="checkpoint-filter">
                  <select
                    aria-label="Filter checkpoints"
                    value={checkpointFilter}
                    onChange={(e) => setCheckpointFilter(e.target.value)}
                  >
                    <option value="all">All checkpoints</option>
                    <option value="elevated">High & severe risk</option>
                    <option value="blocked">No travel & unknown</option>
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              <div className="checkpoint-table-scroll">
                <table className="checkpoint-table">
                  <thead>
                    <tr>
                      <th>CHECKPOINT</th>
                      <th>DISTANCE</th>
                      <th>EST. ARRIVAL</th>
                      <th>
                        <Wind size={12} /> WIND / GUSTS
                      </th>
                      <th>RAIN</th>
                      <th>SNOW</th>
                      <th>WEATHER RISK</th>
                      <th>
                        <span className="sr-only">View checkpoint</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCheckpoints.map((point) => (
                      <tr key={point.id} className={focusedId === point.id ? 'focused-row' : ''}>
                        <td>
                          <span className="checkpoint-index">
                            {String(point.id + 1).padStart(2, '0')}
                          </span>
                          {point.id === 0
                            ? 'Departure'
                            : point.id === selectedRoute.checkpoints.length - 1
                              ? 'Destination'
                              : `Checkpoint ${point.id + 1}`}
                        </td>
                        <td>
                          {number(point.mile, 1)} <small>mi</small>
                        </td>
                        <td>
                          <strong>{time(point.eta, originZone)}</strong>
                          <small>
                            {new Date(point.eta).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              timeZone: originZone,
                            })}
                          </small>
                        </td>
                        <td>
                          {point.weather.wind_mph ?? '—'} <span className="muted">/</span>{' '}
                          {point.weather.gust_mph ?? '—'} <small>mph</small>
                        </td>
                        <td>
                          {point.weather.rain_in?.toFixed(2) ?? '—'} <small>in/hr</small>
                        </td>
                        <td>
                          {point.weather.snow_in?.toFixed(2) ?? '—'} <small>in/hr</small>
                        </td>
                        <td>
                          <span className={`risk-tag risk-${point.risk.level ?? 'unknown'}`}>
                            <i style={{ background: riskColor(point.risk.level) }} />
                            {point.risk.label}
                          </span>
                        </td>
                        <td>
                          <button
                            className="checkpoint-view"
                            aria-label={`View checkpoint ${point.id + 1} on map`}
                            onClick={() => {
                              selectCheckpoint(selectedRoute.id, point.id)
                              document
                                .querySelector('.map-panel')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            }}
                          >
                            <ArrowRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleCheckpoints.length && (
                  <div className="empty-checkpoints">
                    <ShieldCheck size={22} />
                    <strong>No checkpoints match this filter.</strong>
                    <span>Choose another filter to explore this route.</span>
                  </div>
                )}
              </div>
              <div className="checkpoint-footer">
                <Info size={13} />
                <span>
                  Risk uses the worse weather at either end of each stretch.{' '}
                  {plan.mode === 'demo'
                    ? 'Sample weather is synthetic.'
                    : 'Weather provided by Open-Meteo.'}{' '}
                  ETAs exclude rest breaks and live traffic.
                </span>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>
              <Roadmark />
              Made for the road ahead.
            </span>
            <span>
              Routing: Valhalla / OpenStreetMap <i /> Weather:{' '}
              {plan?.mode === 'demo' ? 'Synthetic sample' : 'Open-Meteo'}
              <button onClick={() => setRulesOpen(true)}>
                Methodology
                <ArrowRight size={12} />
              </button>
            </span>
          </footer>
        </main>
      </div>
      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  )
}

function ArrowUpRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 12 12 4M4 4h8v8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
