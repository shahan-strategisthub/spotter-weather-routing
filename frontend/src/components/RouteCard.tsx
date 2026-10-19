import { ArrowUpRight, Check, Clock3, Flag, ShieldCheck } from 'lucide-react'
import type { Route } from '../types'
import { duration, number, riskLabel, ROUTE_COLORS, time } from '../utils'

export default function RouteCard({
  route,
  index,
  selected,
  recommended,
  timezone,
  onSelect,
}: {
  route: Route
  index: number
  selected: boolean
  recommended: boolean
  timezone: string
  onSelect: () => void
}) {
  return (
    <button
      className={`route-card ${selected ? 'selected' : ''} ${recommended ? 'recommended' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="route-card-top">
        <span className="route-number">
          <i style={{ background: ROUTE_COLORS[index % 3] }} /> ROUTE 0{index + 1}
        </span>
        {recommended ? (
          <span className="recommend-tag">
            <ShieldCheck size={12} />
            Recommended
          </span>
        ) : (
          <span className={`risk-tag risk-${route.summary.worst_level ?? 'unknown'}`}>
            {riskLabel(route.summary.worst_level)}
          </span>
        )}
      </div>
      <h3>{route.name}</h3>
      <div className="route-main-stats">
        <strong>{duration(route.duration_seconds)}</strong>
        <span>
          {number(route.distance_miles)} <small>mi</small>
        </span>
        <span className="route-select-icon">
          {selected ? <Check size={15} /> : <ArrowUpRight size={17} />}
        </span>
      </div>
      <div className="risk-strip" aria-label="Miles by weather risk">
        {Object.entries(route.summary.risk_miles)
          .filter(([, miles]) => miles > 0)
          .map(([label, miles]) => (
            <span
              key={label}
              title={`${label}: ${number(miles, 1)} miles`}
              style={{ width: `${(miles / route.distance_miles) * 100}%` }}
              className={`strip-${label.toLowerCase().replace(' ', '-')}`}
            />
          ))}
      </div>
      <div className="route-card-bottom">
        <span>
          <Clock3 size={12} />
          ETA {time(route.arrival, timezone)}
        </span>
        <span>
          <Flag size={12} />
          {route.checkpoints.length} checkpoints
        </span>
      </div>
      <div className="risk-mile-summary">
        <span>
          Severe <b>{number(route.summary.risk_miles.Severe, 1)} mi</b>
        </span>
        <span>
          High <b>{number(route.summary.risk_miles.High, 1)} mi</b>
        </span>
        <span title="Distance-weighted risk score, from 0 (low) to 4 (no travel)">
          Avg <b>{number(route.summary.average_risk, 2)}/4</b>
        </span>
      </div>
      {!route.summary.eligible && (
        <p className="route-blocked">
          {route.summary.risk_miles['No Travel'] > 0
            ? `${number(route.summary.risk_miles['No Travel'], 1)} no-travel miles · excluded`
            : 'Incomplete forecast · excluded'}
        </p>
      )}
    </button>
  )
}
