import type { RiskLevel } from './types'

export const RISK_COLORS = ['#268765', '#d6a230', '#ed803b', '#d54d52', '#853b64']
export const RISK_LABELS = ['Low', 'Moderate', 'High', 'Severe', 'No Travel']
export const ROUTE_COLORS = ['#247a60', '#6d75b0', '#b27d46']
export const riskColor = (level: RiskLevel) => (level === null ? '#78858a' : RISK_COLORS[level])
export const riskLabel = (level: RiskLevel) => (level === null ? 'Unknown' : RISK_LABELS[level])
export function duration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
export const number = (value: number, digits = 0) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits })
export const time = (value: string, zone?: string) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short',
  }).format(new Date(value))
export const dateTime = (value: string, zone?: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short',
  }).format(new Date(value))
export function localInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
export function errorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(errorText).join(' ')
  if (value && typeof value === 'object')
    return Object.entries(value)
      .map(([key, text]) =>
        key === 'error' || key === 'detail'
          ? errorText(text)
          : `${key.replaceAll('_', ' ')}: ${errorText(text)}`,
      )
      .join(' ')
  return 'The request could not be completed.'
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(120_000)
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  })
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('The server did not return a valid response. Please try again.')
  }
  if (!response.ok) throw new Error(errorText(data))
  return data as T
}
