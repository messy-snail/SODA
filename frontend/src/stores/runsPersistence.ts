import type { PropagateResponse } from '../api/types'
import type { OrbitRun } from './runs'

/**
 * Propagation runs kept in `sessionStorage`, so a page reload (including Vite's full reloads
 * during development) restores them. Closing the tab still clears them.
 */
export const RUNS_STORAGE_KEY = 'soda.runs.v1'

export interface StoredRuns {
  runs: OrbitRun[]
  selectedRunId: string | null
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isRun(value: unknown): value is OrbitRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Record<string, unknown>
  const data = run.data as Partial<PropagateResponse> | undefined
  return (
    typeof run.id === 'string' &&
    isNumber(run.noradId) &&
    (run.customId === undefined || run.customId === null || isNumber(run.customId)) &&
    typeof run.name === 'string' &&
    isNumber(run.colorIndex) &&
    typeof run.visible === 'boolean' &&
    isNumber(run.startMs) &&
    isNumber(run.stopMs) &&
    !!data &&
    typeof data === 'object' &&
    isNumber(data.count) &&
    isNumber(data.step_s) &&
    Array.isArray(data.fixed_m) &&
    Array.isArray(data.inertial_m) &&
    Array.isArray(data.invalid)
  )
}

/** Read stored runs, returning an empty state for anything missing or malformed. */
export function loadRuns(storage: StorageLike): StoredRuns {
  try {
    const parsed = JSON.parse(storage.getItem(RUNS_STORAGE_KEY) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return { runs: [], selectedRunId: null }
    const { runs, selectedRunId } = parsed as Record<string, unknown>
    if (!Array.isArray(runs) || !runs.every(isRun)) return { runs: [], selectedRunId: null }
    const selected =
      typeof selectedRunId === 'string' && runs.some((run) => run.id === selectedRunId)
        ? selectedRunId
        : null
    // Runs saved before user-supplied elements existed have no customId, and those saved
    // before there was a choice of propagator are all SGP4.
    return {
      runs: runs.map((run) => ({
        ...run,
        customId: run.customId ?? null,
        propagator: run.propagator ?? 'sgp4',
        hpop: run.hpop ?? null,
      })),
      selectedRunId: selected,
    }
  } catch {
    return { runs: [], selectedRunId: null }
  }
}

/**
 * Store the runs; returns false when storage refused them (usually the quota for long runs).
 * A refused write removes the older copy so a reload never restores a stale list.
 */
export function saveRuns(storage: StorageLike, state: StoredRuns): boolean {
  try {
    if (!state.runs.length) storage.removeItem(RUNS_STORAGE_KEY)
    else storage.setItem(RUNS_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    try {
      storage.removeItem(RUNS_STORAGE_KEY)
    } catch {
      /* Storage is unavailable altogether. */
    }
    return false
  }
}

/** The numeric suffix of `run-<n>` ids, so new ids continue after the restored ones. */
export function lastSequence(runs: OrbitRun[]): number {
  return runs.reduce((max, run) => {
    const n = Number(/^run-(\d+)$/.exec(run.id)?.[1])
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
}
