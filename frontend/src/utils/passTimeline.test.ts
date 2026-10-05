import { describe, expect, it } from 'vitest'
import {
  MIN_BAR_WIDTH,
  activeContacts,
  barLayout,
  formatCountdown,
  jumpTarget,
  passSpan,
  timelineTicks,
} from './passTimeline'

const DAY = 86_400_000
const start = Date.UTC(2026, 8, 16)
const end = start + DAY

describe('barLayout', () => {
  it('maps an interval to a fraction of the window', () => {
    const bar = barLayout(start + 6 * 3_600_000, start + 12 * 3_600_000, start, end)
    expect(bar).toEqual({ start: 0.25, width: 0.25, clipped: false })
  })

  it('gives a very short pass a visible width without leaving the track', () => {
    const bar = barLayout(end - 1000, end, start, end)!
    expect(bar.width).toBe(MIN_BAR_WIDTH)
    expect(bar.start + bar.width).toBeCloseTo(1)
  })

  it('clamps a pass that overruns an edge and marks it clipped', () => {
    const bar = barLayout(start - DAY, start + DAY / 2, start, end)!
    expect(bar.start).toBe(0)
    expect(bar.width).toBeCloseTo(0.5)
    expect(bar.clipped).toBe(true)
  })

  it('drops an interval outside the window', () => {
    expect(barLayout(end + 1, end + DAY, start, end)).toBeNull()
    expect(barLayout(start - DAY, start, start, end)).toBeNull()
    expect(barLayout(start, end, end, start)).toBeNull()
  })
})

describe('timelineTicks', () => {
  it('lands on round UTC times inside the window', () => {
    const ticks = timelineTicks(start, end)
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(ticks.every((tick) => tick.ms % 3_600_000 === 0)).toBe(true)
    expect(ticks.every((tick) => tick.at >= 0 && tick.at <= 1)).toBe(true)
  })

  it('widens the step for long windows', () => {
    const week = timelineTicks(start, start + 7 * DAY)
    expect(week.length).toBeLessThanOrEqual(6)
    expect(week.every((tick) => tick.ms % DAY === 0)).toBe(true)
  })

  it('returns nothing for an empty window', () => {
    expect(timelineTicks(start, start)).toEqual([])
  })
})

describe('passSpan', () => {
  it('shows AOS and LOS times on one day', () => {
    const aos = Date.UTC(2026, 8, 25, 20, 53, 45)
    expect(passSpan(aos, aos + 404_000)).toEqual({
      date: '09-25',
      aos: '20:53:45',
      los: '21:00:29',
    })
  })

  it('dates LOS when the pass crosses midnight', () => {
    const aos = Date.UTC(2026, 8, 25, 23, 58, 0)
    expect(passSpan(aos, aos + 300_000).los).toBe('09-26 00:03:00')
  })
})

describe('activeContacts', () => {
  const at = (h: number, m = 0) => new Date(start + h * 3_600_000 + m * 60_000).toISOString()
  const entries = [
    { id: 'a', pass: { aos: at(8, 44), los: at(8, 52) } },
    { id: 'b', pass: { aos: at(8, 48), los: at(8, 54) } },
    { id: 'c', pass: { aos: at(21, 30), los: at(21, 33) } },
  ]

  it('lists every contact holding the time, with the time left until LOS', () => {
    const now = Date.parse(at(8, 50))
    expect(activeContacts(entries, now)).toEqual([
      { entry: entries[0], remainingMs: 2 * 60_000 },
      { entry: entries[1], remainingMs: 4 * 60_000 },
    ])
  })

  it('counts AOS and LOS themselves as in contact', () => {
    expect(activeContacts(entries, Date.parse(at(8, 44))).map((c) => c.entry.id)).toEqual(['a'])
    expect(activeContacts(entries, Date.parse(at(8, 54)))[0].remainingMs).toBe(0)
  })

  it('is empty between contacts', () => {
    expect(activeContacts(entries, Date.parse(at(12)))).toEqual([])
  })
})

describe('formatCountdown', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatCountdown(192_400)).toBe('03:12')
  })

  it('adds hours from an hour up and never goes negative', () => {
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
    expect(formatCountdown(-5)).toBe('00:00')
  })
})

describe('jumpTarget', () => {
  it('lands on AOS or on the culmination', () => {
    const contact = { aos: '2026-09-16T10:00:00.000Z', tca: '2026-09-16T10:04:30.000Z' }
    expect(jumpTarget(contact, 'aos')).toBe(Date.parse(contact.aos))
    expect(jumpTarget(contact, 'tca')).toBe(Date.parse(contact.tca))
  })
})
