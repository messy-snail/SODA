import { describe, expect, it } from 'vitest'
import type { Pass, PassesResponse, Station } from '../api/types'
import { planCsv, planWindows } from './passPlan'

const DAY = 86_400_000
const T0 = Date.parse('2026-09-16T00:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

function pass(id: string, satellite: number, aosMin: number, status: Pass['status']): Pass {
  const aos = T0 + aosMin * 60_000
  return {
    id,
    satellite_index: satellite,
    status,
    conflict_with: status === 'rejected' ? ['a'] : [],
    station_id: 1,
    aos: iso(aos),
    tca: iso(aos + 240_000),
    los: iso(aos + 480_000),
    duration_s: 480,
    max_elevation_deg: 40,
    tca_range_km: 700,
  } as Pass
}

const plan = {
  satellites: [0, 1].map((index) => ({
    index,
    element_set: { norad_id: 100 + index, name: `SAT, ${index}` },
    start: iso(T0),
    end: iso(T0 + DAY),
    results: [
      {
        station: { id: 1 } as Station,
        passes: [index === 0 ? pass('a', 0, 62, 'assigned') : pass('b', 1, 60, 'rejected')],
      },
    ],
  })),
  turnaround_s: 60,
  assigned: 1,
  rejected: 1,
  warnings: [],
} as unknown as PassesResponse

describe('planWindows', () => {
  it('keeps runs whole while they fit the budget', () => {
    expect(planWindows([{ startMs: T0, stopMs: T0 + 30 * DAY }])).toEqual([
      { startMs: T0, endMs: T0 + 30 * DAY, clipped: false },
    ])
  })

  it('shares the satellite-day budget equally once it is exceeded', () => {
    const runs = Array.from({ length: 4 }, () => ({ startMs: T0, stopMs: T0 + 30 * DAY }))
    expect(planWindows(runs).map((w) => (w.endMs - w.startMs) / DAY)).toEqual([15, 15, 15, 15])
    expect(planWindows(runs).every((w) => w.clipped)).toBe(true)
  })
})

describe('planCsv', () => {
  it('writes one quoted-when-needed line per pass in AOS order', () => {
    const csv = planCsv(
      plan,
      (index) => plan.satellites[index]!.element_set.name,
      (id) => `GS ${id}`,
    )
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^status,priority,satellite,norad_id,station,aos_utc/)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('rejected,2,"SAT, 1",101,GS 1')
    expect(lines[2]).toContain('assigned,1,"SAT, 0",100,GS 1')
  })
})
