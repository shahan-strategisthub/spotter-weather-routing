import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, MapPin, Search } from 'lucide-react'
import type { Place } from '../types'
import { request } from '../utils'

export default function PlaceInput({
  label,
  value,
  onChange,
  kind,
}: {
  label: string
  value: Place | null
  onChange: (value: Place | null) => void
  kind: 'origin' | 'destination'
}) {
  const id = useId()
  const [text, setText] = useState(value?.label.split(',').slice(0, 2).join(',') ?? '')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(-1)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (value) setText(value.label.split(',').slice(0, 2).join(','))
  }, [value])
  useEffect(() => {
    if (value || text.trim().length < 2) {
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const response = await request<{ results: Place[] }>(
          `/api/geocode/?q=${encodeURIComponent(text)}`,
          { signal: controller.signal },
        )
        setResults(response.results)
        setActive(-1)
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Place search is unavailable.')
          setResults([])
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [text, value])
  function choose(place: Place) {
    onChange(place)
    setOpen(false)
    setResults([])
  }
  return (
    <div
      className="place-control"
      ref={container}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="place-field">
        <span className={`location-symbol ${kind}`} aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={open && !value}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off"
          placeholder={kind === 'origin' ? 'Search departure city' : 'Search destination city'}
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value)
            onChange(null)
            setOpen(true)
            setLoading(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, results.length - 1))
              setOpen(true)
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            }
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && open && active >= 0 && results[active]) {
              e.preventDefault()
              choose(results[active])
            }
          }}
        />
        {loading ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Search size={15} className="muted" />
        )}
      </div>
      {open && !value && text.length >= 2 && (
        <div
          className="place-options"
          id={`${id}-options`}
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {loading ? (
            <p>Searching places…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : results.length ? (
            results.map((place, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                aria-selected={index === active}
                className={index === active ? 'active' : ''}
                key={`${place.lat},${place.lng}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(place)}
              >
                <MapPin size={16} />
                <span>
                  <strong>{place.name}</strong>
                  <small>{place.label}</small>
                </span>
              </button>
            ))
          ) : (
            <p>No matching places. Try a city name.</p>
          )}
        </div>
      )}
    </div>
  )
}
