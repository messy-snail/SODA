import { describe, expect, it } from 'vitest'
import type { PropagateResponse } from '../api/types'
import type { OrbitRun } from './runs'
import { lastSequence, loadRuns, RUNS_STORAGE_KEY, saveRuns } from './runsPersistence'

function memoryStorage(quota = Infinity) {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > quota) throw new DOMException('full', 'QuotaExceededError')
      entries.set(key, value)
    },
    removeItem: (key: string) => void entries.delete(key),
  }
}

function run(id: string, colorIndex = 0): OrbitRun {
  return {
    id,
    noradId: 25544,
    customId: null,
    name: 'ISS (ZARYA)',
    colorIndex,
    visible: true,
    startMs: 1_000,
    stopMs: 61_000,
    propagator: 'sgp4',
    hpop: null,
    data: {
      start: '2026-09-25T00:00:00Z',
      step_s: 60,
      count: 2,
      invalid: [],
      fixed_m: [1, 2, 3, 4, 5, 6],
      inertial_m: [1, 2, 3, 4, 5, 6],
    } as unknown as PropagateResponse,
  }
}

describe('runs persistence', () => {
  it('round-trips runs and the selection', () => {
    const storage = memoryStorage()
    const runs = [run('run-3'), run('run-7', 1)]
    expect(saveRuns(storage, { runs, selectedRunId: 'run-7' })).toBe(true)
    expect(loadRuns(storage)).toEqual({ runs, selectedRunId: 'run-7' })
  })

  it('reads runs saved before user-supplied elements as catalog runs', () => {
    const storage = memoryStorage()
    const old: Partial<OrbitRun> = run('run-2')
    delete old.customId
    storage.setItem(RUNS_STORAGE_KEY, JSON.stringify({ runs: [old], selectedRunId: null }))
    expect(loadRuns(storage).runs[0]!.customId).toBeNull()
  })

  it('reads runs saved before there was a choice of propagator as SGP4', () => {
    const storage = memoryStorage()
    const old: Partial<OrbitRun> = run('run-2')
    delete old.propagator
    delete old.hpop
    storage.setItem(RUNS_STORAGE_KEY, JSON.stringify({ runs: [old], selectedRunId: null }))
    expect(loadRuns(storage).runs[0]).toMatchObject({ propagator: 'sgp4', hpop: null })

    const hpop = { ...run('run-3'), propagator: 'hpop' as const, hpop: { gravity_degree: 20 } }
    storage.setItem(RUNS_STORAGE_KEY, JSON.stringify({ runs: [hpop], selectedRunId: null }))
    expect(loadRuns(storage).runs[0]).toMatchObject({
      propagator: 'hpop',
      hpop: { gravity_degree: 20 },
    })
  })

  it('drops a selection that no longer names a stored run', () => {
    const storage = memoryStorage()
    saveRuns(storage, { runs: [run('run-1')], selectedRunId: 'run-9' })
    expect(loadRuns(storage).selectedRunId).toBeNull()
  })

  it('returns an empty state for missing or malformed data', () => {
    const storage = memoryStorage()
    expect(loadRuns(storage)).toEqual({ runs: [], selectedRunId: null })
    storage.setItem(RUNS_STORAGE_KEY, '{not json')
    expect(loadRuns(storage).runs).toEqual([])
    storage.setItem(RUNS_STORAGE_KEY, JSON.stringify({ runs: [{ id: 'run-1' }] }))
    expect(loadRuns(storage).runs).toEqual([])
  })

  it('clears the key when the list empties or the quota refuses the write', () => {
    const oneRun = JSON.stringify({ runs: [run('run-1')], selectedRunId: null })
    const storage = memoryStorage(oneRun.length)
    saveRuns(storage, { runs: [run('run-1')], selectedRunId: null })
    expect(storage.entries.has(RUNS_STORAGE_KEY)).toBe(true)
    expect(saveRuns(storage, { runs: [run('run-1'), run('run-2')], selectedRunId: null })).toBe(
      false,
    )
    expect(storage.entries.has(RUNS_STORAGE_KEY)).toBe(false)
    saveRuns(storage, { runs: [run('run-1')], selectedRunId: null })
    saveRuns(storage, { runs: [], selectedRunId: null })
    expect(storage.entries.has(RUNS_STORAGE_KEY)).toBe(false)
  })

  it('continues run ids after the restored ones', () => {
    expect(lastSequence([])).toBe(0)
    expect(lastSequence([run('run-3'), run('run-12'), run('other')])).toBe(12)
  })
})
