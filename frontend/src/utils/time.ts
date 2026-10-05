const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** ``2026-09-16 04:05:06`` in UTC. */
export function formatUtc(ms: number, withSeconds = true): string {
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return `${date} ${time}${withSeconds ? `:${pad(d.getUTCSeconds())}` : ''}`
}

/**
 * The same instant on the reader's own wall clock, laid out like ``formatUtc``.
 *
 * Paired with ``localZoneLabel`` this replaces a hard-coded ``+9``: a reader in Korea
 * still sees Seoul time, and a reader anywhere else sees their own rather than Seoul's.
 */
export function formatLocal(ms: number): string {
  return formatUtc(ms - new Date(ms).getTimezoneOffset() * 60_000).slice(11)
}

/**
 * ``UTC+9``, ``UTC-4:30`` or ``UTC``.
 *
 * An offset rather than an abbreviation: CLDR has no short name for most zones - Seoul
 * included, where it falls back to ``GMT+9`` - and an offset reads the same in every
 * language, so it needs no translation.
 */
export function localZoneLabel(ms: number): string {
  const minutes = -new Date(ms).getTimezoneOffset()
  if (!minutes) return 'UTC'
  const rest = Math.abs(minutes) % 60
  const hours = Math.floor(Math.abs(minutes) / 60)
  return `UTC${minutes < 0 ? '-' : '+'}${hours}${rest ? `:${pad(rest)}` : ''}`
}

/** Value for ``<input type="datetime-local">`` interpreted as UTC. */
export function toUtcInput(ms: number): string {
  return formatUtc(ms, false).replace(' ', 'T')
}

/** Parse a ``datetime-local`` string as UTC; returns ``NaN`` when invalid. */
export function fromUtcInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return Number.NaN
  return Date.parse(`${value}${value.length === 16 ? ':00' : ''}Z`)
}

export interface DurationParts {
  /** Which two units to show; the message catalogue has one phrasing per unit. */
  unit: 'days' | 'hours' | 'minutes' | 'seconds'
  days: number
  hours: number
  minutes: number
  /** Zero-padded, so a column of durations stays aligned. */
  seconds: string
}

/**
 * Split a duration into the two units worth showing.
 *
 * The wording is left to the caller: this stays pure so it can be tested without a
 * language, and so the same numbers render in either one.
 */
export function splitDuration(seconds: number): DurationParts {
  const total = Math.round(Math.abs(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const unit = days ? 'days' : hours ? 'hours' : minutes ? 'minutes' : 'seconds'
  return { unit, days, hours, minutes, seconds: pad(total % 60) }
}

export interface RelativeSpan {
  unit: 'now' | 'minutes' | 'hours' | 'days'
  count: number
}

/** How long ago ``ms`` was, in the coarsest unit that is at least one. */
export function relativeSpan(ms: number, now = Date.now()): RelativeSpan {
  const seconds = Math.max(0, (now - ms) / 1000)
  if (seconds < 60) return { unit: 'now', count: 0 }
  if (seconds < 3600) return { unit: 'minutes', count: Math.floor(seconds / 60) }
  if (seconds < 86400) return { unit: 'hours', count: Math.floor(seconds / 3600) }
  return { unit: 'days', count: Math.floor(seconds / 86400) }
}
