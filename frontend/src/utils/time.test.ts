import { describe, expect, it } from 'vitest'
import {
  formatLocal,
  formatUtc,
  fromUtcInput,
  localZoneLabel,
  relativeSpan,
  splitDuration,
  toUtcInput,
} from './time'

describe('time utils', () => {
  const ms = Date.UTC(2026, 8, 16, 4, 5, 6)

  it('formats UTC timestamps', () => {
    expect(formatUtc(ms)).toBe('2026-09-16 04:05:06')
    expect(formatUtc(ms, false)).toBe('2026-09-16 04:05')
  })

  it('shows the same instant on the local clock, tagged with its offset', () => {
    // The runner's zone is whatever it is, so assert the relationship rather than a value.
    const offsetMinutes = -new Date(ms).getTimezoneOffset()
    expect(formatLocal(ms)).toBe(formatUtc(ms + offsetMinutes * 60_000).slice(11))
    const label = localZoneLabel(ms)
    expect(label).toMatch(/^UTC$|^UTC[+-]\d{1,2}(:\d{2})?$/)
    if (offsetMinutes === 0) expect(label).toBe('UTC')
  })

  it('round-trips datetime-local values as UTC', () => {
    expect(toUtcInput(ms)).toBe('2026-09-16T04:05')
    expect(fromUtcInput('2026-09-16T04:05')).toBe(Date.UTC(2026, 8, 16, 4, 5))
    expect(fromUtcInput('2026-09-16T04:05:30')).toBe(Date.UTC(2026, 8, 16, 4, 5, 30))
    expect(fromUtcInput('yesterday')).toBeNaN()
  })

  it('splits a duration into the two units worth showing', () => {
    expect(splitDuration(42)).toMatchObject({ unit: 'seconds', seconds: '42' })
    expect(splitDuration(402)).toMatchObject({ unit: 'minutes', minutes: 6, seconds: '42' })
    expect(splitDuration(3 * 3600 + 120)).toMatchObject({ unit: 'hours', hours: 3, minutes: 2 })
    expect(splitDuration(2 * 86400 + 3600)).toMatchObject({ unit: 'days', days: 2, hours: 1 })
    // Seconds are padded so a column of durations lines up.
    expect(splitDuration(65).seconds).toBe('05')
    // A negative span is still a span.
    expect(splitDuration(-42)).toMatchObject({ unit: 'seconds', seconds: '42' })
  })

  it('picks the coarsest unit for how long ago something was', () => {
    expect(relativeSpan(ms - 30_000, ms)).toEqual({ unit: 'now', count: 0 })
    expect(relativeSpan(ms - 18 * 60_000, ms)).toEqual({ unit: 'minutes', count: 18 })
    expect(relativeSpan(ms - 5 * 3_600_000, ms)).toEqual({ unit: 'hours', count: 5 })
    expect(relativeSpan(ms - 3 * 86_400_000, ms)).toEqual({ unit: 'days', count: 3 })
    // A timestamp in the future reads as just now rather than a negative count.
    expect(relativeSpan(ms + 60_000, ms)).toEqual({ unit: 'now', count: 0 })
  })
})
