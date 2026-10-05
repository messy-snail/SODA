import type { PassesResponse } from '../api/types'

/**
 * Limits of a pass prediction (`orbit/contacts.py`, `orbit/passes.py`): satellites per
 * request, days per satellite, satellite-days in all, and the antenna turnaround.
 */
export const MAX_SATELLITES = 8
export const MAX_PASS_DAYS = 30
export const MAX_SATELLITE_DAYS = 60
export const MAX_TURNAROUND_S = 3600
const DAY_MS = 86_400_000

export interface PlanWindow {
  startMs: number
  endMs: number
  /** Shorter than the run, to keep the request inside the satellite-day budget. */
  clipped: boolean
}

/**
 * The part of each run a prediction searches: all of it while the runs fit the budget,
 * otherwise an equal share of it for each satellite, from the start of its run.
 */
export function planWindows(runs: readonly { startMs: number; stopMs: number }[]): PlanWindow[] {
  const total = runs.reduce((sum, run) => sum + (run.stopMs - run.startMs) / DAY_MS, 0)
  const share = total > MAX_SATELLITE_DAYS ? MAX_SATELLITE_DAYS / runs.length : MAX_PASS_DAYS
  return runs.map((run) => {
    const endMs = Math.min(run.stopMs, run.startMs + Math.min(share, MAX_PASS_DAYS) * DAY_MS)
    return { startMs: run.startMs, endMs, clipped: endMs < run.stopMs }
  })
}

const csvCell = (value: string | number) => {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Every pass as CSV, one line each in AOS order. Names are passed in so the file uses the
 * same labels as the screen.
 */
export function planCsv(
  plan: PassesResponse,
  satelliteName: (index: number) => string,
  stationName: (id: number) => string,
): string {
  const header = [
    'status',
    'priority',
    'satellite',
    'norad_id',
    'station',
    'aos_utc',
    'tca_utc',
    'los_utc',
    'duration_s',
    'max_elevation_deg',
    'tca_range_km',
    'conflicts',
  ]
  const passes = plan.satellites
    .flatMap((satellite) => satellite.results.flatMap((result) => result.passes))
    .sort((a, b) => Date.parse(a.aos) - Date.parse(b.aos))
  const lines = passes.map((p) =>
    [
      p.status,
      p.satellite_index + 1,
      satelliteName(p.satellite_index),
      plan.satellites[p.satellite_index]?.element_set.norad_id ?? '',
      stationName(p.station_id),
      p.aos,
      p.tca,
      p.los,
      p.duration_s.toFixed(1),
      p.max_elevation_deg.toFixed(2),
      p.tca_range_km.toFixed(1),
      p.conflict_with.length,
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n') + '\n'
}
