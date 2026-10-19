export type RiskLevel = 0 | 1 | 2 | 3 | 4 | null
export type Place = { name?: string; label: string; lat: number; lng: number; timezone: string }
export type Risk = { level: RiskLevel; label: string; reasons: string[] }
export type Weather = {
  wind_mph: number | null
  gust_mph: number | null
  rain_in: number | null
  snow_in: number | null
  temperature_f: number | null
  forecast_time: string | null
}
export type Checkpoint = {
  id: number
  lat: number
  lng: number
  mile: number
  elapsed_seconds: number
  eta: string
  weather: Weather
  risk: Risk
}
export type Route = {
  id: string
  name: string
  source: string
  geometry: [number, number][]
  distance_miles: number
  duration_seconds: number
  arrival: string
  eta_method: string
  checkpoints: Checkpoint[]
  summary: {
    risk_miles: Record<string, number>
    average_risk: number
    worst_level: RiskLevel
    worst_label: string
    eligible: boolean
  }
}
export type ForecastFrame = {
  level: RiskLevel
  wind_mph: number | null
  rain_in: number | null
  snow_in: number | null
}
export type CorridorCell = { lat: number; lng: number; frames: ForecastFrame[] }
export type Plan = {
  mode: 'demo' | 'live'
  generated_at: string
  departure: string
  origin: Place
  destination: Place
  load_lb: number
  interval_miles: number
  routes: Route[]
  recommended_route_id: string | null
  recommendation_reason: string
  corridor: CorridorCell[]
  forecast_hours: string[]
  warnings: string[]
  providers: { routing: string; weather: string }
}
export type Metric = 'risk' | 'wind' | 'rain' | 'snow'
