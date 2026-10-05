import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { api } from '../api/client'
import type { AccessResponse, PassesResponse, PropagateResponse } from '../api/types'
import { useMissionStore } from './mission'
import { usePassesStore } from './passes'
import { usePowerStore } from './power'
import { useRunsStore } from './runs'

const START = Date.UTC(2026, 8, 24)
const input = { noradId: 25544, customId: null, startMs: START, endMs: START + 86400000, stepS: 30 }

function propagated(): PropagateResponse {
  return {
    element_set: { name: 'Test satellite' },
    start: '2026-09-24T00:00:00Z',
    step_s: 30,
    count: 2881,
    invalid: [],
    fixed_m: [],
    inertial_m: [],
    warnings: [],
  } as unknown as PropagateResponse
}

/** One acquisition of the given target. */
const access = (targetId: string) =>
  ({
    results: [
      {
        target_id: targetId,
        windows: [
          {
            start: '2026-09-24T01:00:00Z',
            shot_start: '2026-09-24T01:00:10Z',
            shot_end: '2026-09-24T01:00:20Z',
            roll_deg: 5,
            pitch_deg: 0,
          },
        ],
      },
    ],
    warnings: [],
  }) as unknown as AccessResponse

/** A plan of two satellites where only the first one has a contact. */
const plan = {
  satellites: [
    {
      index: 0,
      results: [
        {
          station: { id: 1 },
          passes: [
            {
              status: 'assigned',
              station_id: 1,
              aos: '2026-09-24T02:00:00Z',
              los: '2026-09-24T02:08:00Z',
            },
          ],
        },
      ],
    },
    { index: 1, results: [] },
  ],
  warnings: [],
} as unknown as PassesResponse

const noAccess = { results: [], warnings: [] } as unknown as AccessResponse

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
  vi.spyOn(api, 'propagate').mockImplementation(async () => propagated())
  // Only the first satellite ever sees the target.
  vi.spyOn(api, 'access').mockImplementation(async (body) =>
    'norad_id' in body && body.norad_id === 25544 ? access(body.targets[0]!.id) : noAccess,
  )
  vi.spyOn(api, 'passes').mockResolvedValue(plan)
})

describe('power inputs follow the target satellite', () => {
  async function setUp() {
    const runs = useRunsStore()
    const mission = useMissionStore()
    const passes = usePassesStore()
    const first = (await runs.propagate(input))!
    const second = (await runs.propagate({ ...input, noradId: 12345 }))!
    mission.addPoint(36, 127)
    await mission.compute()
    passes.selectOnly([1])
    await passes.predict(runs.runs)
    return { runs, first, second, power: usePowerStore() }
  }

  it('takes the acquisitions and contacts of the selected satellite only', async () => {
    const { runs, first, second, power } = await setUp()
    runs.select(first.id)
    expect(power.shots).toHaveLength(1)
    expect(power.contacts).toEqual([
      { start: '2026-09-24T02:00:00Z', end: '2026-09-24T02:08:00Z', station_id: 1, downlink: true },
    ])
    expect(power.notices).toEqual({ noPlan: false, noShots: false, stale: false })

    runs.select(second.id)
    expect(power.run?.id).toBe(second.id)
    expect(power.shots).toEqual([])
    expect(power.contacts).toEqual([])
    expect(power.notices).toEqual({ noPlan: false, noShots: false, stale: false })
  })

  it('says so when a satellite was propagated after the imaging search and the pass plan', async () => {
    const { runs, power } = await setUp()
    const late = (await runs.propagate({ ...input, noradId: 43013 }))!
    runs.select(late.id)
    expect(power.shots).toEqual([])
    expect(power.notices).toEqual({ noPlan: true, noShots: true, stale: false })
  })

  it('falls back to the first run when nothing is selected', async () => {
    const { runs, first, power } = await setUp()
    runs.select(null)
    expect(power.run?.id).toBe(first.id)
    expect(power.shots).toHaveLength(1)
  })

  it('keeps the inputs when the satellite is propagated again, and says they are older', async () => {
    const { runs, first, power } = await setUp()
    const again = (await runs.propagate(input))!
    expect(again.id).not.toBe(first.id)
    runs.select(again.id)
    expect(power.shots).toHaveLength(1)
    expect(power.contacts).toHaveLength(1)
    expect(power.notices).toEqual({ noPlan: false, noShots: false, stale: true })
  })
})
