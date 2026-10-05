import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { AccessResponse, PropagateResponse } from '../api/types'
import { defaultCoverageSettings } from '../mission/coverage'
import { defaultPowerSettings } from '../mission/power'
import { defaultStorageSettings } from '../mission/storage'
import { MAX_TARGETS } from '../mission/targets'
import { sanitizeMission, useMissionStore } from './mission'
import { useRunsStore } from './runs'

describe('sanitizeMission', () => {
  it('falls back for missing or broken values', () => {
    expect(sanitizeMission(null)).toEqual({
      targets: [],
      pointingMode: 'roll',
      maxRollDeg: 30,
      maxPitchDeg: 30,
      fovDeg: 0,
      minSunElevDeg: 10,
      storage: defaultStorageSettings(),
      power: defaultPowerSettings(),
      coverage: defaultCoverageSettings(),
    })
    expect(sanitizeMission({ maxRollDeg: 120, minSunElevDeg: 'x', fovDeg: -1 })).toMatchObject({
      maxRollDeg: 30,
      minSunElevDeg: 10,
      fovDeg: 0,
    })
  })

  it('carries an old off-nadir limit over as the roll limit', () => {
    expect(sanitizeMission({ maxOffNadirDeg: 45 })).toMatchObject({
      maxRollDeg: 45,
      pointingMode: 'roll',
    })
  })

  it('reads storage settings saved before the recorder had bands', () => {
    const { storage } = sanitizeMission({
      storage: { capacityGbit: 256, downlinkMbps: 150, noDownlinkStationIds: [4] },
    })
    expect(storage).toEqual({
      ...defaultStorageSettings(),
      capacityGbit: 256,
      xMbps: 150,
      noDownlinkStationIds: [4],
    })
  })

  it('drops duplicate ids and caps the list', () => {
    const point = (id: string) => ({ kind: 'point', id, name: id, lat_deg: 0, lon_deg: 0 })
    const many = Array.from({ length: MAX_TARGETS + 5 }, (_, i) => point(`t${i}`))
    expect(sanitizeMission({ targets: many }).targets).toHaveLength(MAX_TARGETS)
    expect(sanitizeMission({ targets: [point('a'), point('a')] }).targets).toHaveLength(1)
  })
})

describe('placing targets on the globe', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('adds a point with one click and stops placing', () => {
    const mission = useMissionStore()
    mission.setPlacing('point')
    mission.receiveClick(127, 37)
    expect(mission.saved.targets).toMatchObject([{ kind: 'point', lat_deg: 37, lon_deg: 127 }])
    expect(mission.placing).toBeNull()
  })

  it('adds an area from two corners', () => {
    const mission = useMissionStore()
    mission.setPlacing('box')
    mission.receiveClick(130, 38)
    expect(mission.corner).toEqual({ lon_deg: 130, lat_deg: 38 })
    expect(mission.saved.targets).toHaveLength(0)
    mission.receiveClick(125, 33)
    expect(mission.saved.targets).toMatchObject([
      { kind: 'box', west_deg: 125, south_deg: 33, east_deg: 130, north_deg: 38 },
    ])
    expect(mission.corner).toBeNull()
    expect(mission.placing).toBeNull()
  })

  it('returns the id of what it added, or null when it added nothing', () => {
    const mission = useMissionStore()
    const id = mission.addPoint(36, 127, 'Daejeon')
    expect(mission.saved.targets).toMatchObject([{ id, name: 'Daejeon' }])
    const box = { west_deg: 125, south_deg: 33, east_deg: 130, north_deg: 38 }
    expect(mission.addBox({ ...box, north_deg: 33 })).toBeNull()
    for (let n = 1; n < MAX_TARGETS; n++) mission.addBox(box)
    expect(mission.saved.targets).toHaveLength(MAX_TARGETS)
    expect(mission.addPoint(0, 0)).toBeNull()
    expect(mission.addBox(box)).toBeNull()
  })

  it('names new targets without clashing', () => {
    const mission = useMissionStore()
    mission.addPoint(0, 0)
    mission.addPoint(1, 1)
    mission.removeTarget(mission.saved.targets[0]!.id)
    mission.addPoint(2, 2)
    const names = mission.saved.targets.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('imaging search over every propagated satellite', () => {
  const START = Date.UTC(2026, 8, 24)
  const input = {
    noradId: 25544,
    customId: null,
    startMs: START,
    endMs: START + 86400000,
    stepS: 30,
  }
  const propagated = () =>
    ({
      element_set: { name: 'Test satellite' },
      start: '2026-09-24T00:00:00Z',
      step_s: 30,
      count: 2881,
      invalid: [],
      fixed_m: [],
      inertial_m: [],
      warnings: [],
    }) as unknown as PropagateResponse
  /** One window per target, an hour into the run for the first satellite and two for the rest. */
  const answer = (body: { targets: { id: string }[] }, hour: number) =>
    ({
      results: body.targets.map((target) => ({
        target_id: target.id,
        windows: [
          {
            start: `2026-09-24T0${hour}:00:00Z`,
            best_time: `2026-09-24T0${hour}:00:05Z`,
            shot_start: `2026-09-24T0${hour}:00:00Z`,
            shot_end: `2026-09-24T0${hour}:00:10Z`,
          },
        ],
      })),
      warnings: [],
    }) as unknown as AccessResponse

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.spyOn(api, 'propagate').mockImplementation(async () => propagated())
  })

  async function twoRuns() {
    const runs = useRunsStore()
    const first = (await runs.propagate(input))!
    const second = (await runs.propagate({ ...input, noradId: 43013 }))!
    const mission = useMissionStore()
    mission.addPoint(36, 127)
    return { runs, mission, first, second }
  }

  it('asks once per satellite and merges the windows in time order', async () => {
    const call = vi
      .spyOn(api, 'access')
      .mockImplementation(async (body) =>
        answer(body, 'norad_id' in body && body.norad_id === 25544 ? 2 : 1),
      )
    const { mission, first, second } = await twoRuns()
    expect(mission.stale).toBe(true)
    await mission.compute()
    expect(call).toHaveBeenCalledTimes(2)
    expect(mission.multi).toBe(true)
    expect(mission.stale).toBe(false)
    expect(mission.shots.map((shot) => shot.run.id)).toEqual([second.id, first.id])
    expect(mission.resultOf(first)?.run.id).toBe(first.id)
    expect(mission.shotIndex.get(mission.shots[0]!.key)).toBe(mission.shots[0])
    expect(mission.loading).toBe(false)
    expect(mission.progress).toBeNull()
  })

  it('keeps the satellites that answered when one fails', async () => {
    vi.spyOn(api, 'access').mockImplementation(async (body) => {
      if ('norad_id' in body && body.norad_id === 43013) throw new ApiError('boom', 500)
      return answer(body, 1)
    })
    const { mission, first, second } = await twoRuns()
    await mission.compute()
    expect(mission.results.map((item) => item.run.id)).toEqual([first.id])
    expect(mission.failures.map((item) => item.run.id)).toEqual([second.id])
    expect(mission.error).toBeNull()
    expect(mission.resultOf(second)).toBeNull()
  })

  it('leaves the previous result in place when every satellite fails', async () => {
    const access = vi.spyOn(api, 'access').mockImplementation(async (body) => answer(body, 1))
    const { mission } = await twoRuns()
    await mission.compute()
    access.mockRejectedValue(new ApiError('boom', 500))
    await mission.compute()
    expect(mission.results).toHaveLength(2)
    expect(mission.error).toBeInstanceOf(ApiError)
  })

  it('goes stale when targets, pointing or the runs change, and drops removed satellites', async () => {
    vi.spyOn(api, 'access').mockImplementation(async (body) => answer(body, 1))
    const { runs, mission, second } = await twoRuns()
    await mission.compute()
    mission.saved.maxRollDeg += 1
    expect(mission.stale).toBe(true)
    mission.saved.maxRollDeg -= 1
    expect(mission.stale).toBe(false)
    runs.remove(second.id)
    expect(mission.stale).toBe(true)
    expect(mission.shots).toHaveLength(1)
  })

  it('switches single windows off by their shot key', async () => {
    vi.spyOn(api, 'access').mockImplementation(async (body) => answer(body, 1))
    const { mission } = await twoRuns()
    await mission.compute()
    const [one, other] = mission.shots
    expect(one!.key).not.toBe(other!.key)
    mission.toggleShot(one!.key)
    expect([...mission.excludedShots]).toEqual([one!.key])
    mission.toggleShot(one!.key)
    expect(mission.excludedShots.size).toBe(0)
  })
})
