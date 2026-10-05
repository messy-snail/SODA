import { describe, expect, it } from 'vitest'
import type { AccessResponse, AccessWindow } from '../api/types'
import { flattenShots, satSlug, shotKey, type AccessRun, type SatelliteAccess } from './shots'
import type { ImagingTarget } from './targets'

const window = (best: string) => ({ start: best, best_time: best }) as unknown as AccessWindow

function access(noradId: number, windows: Record<string, string[]>): SatelliteAccess {
  const run: AccessRun = {
    id: `run-${noradId}`,
    name: `SAT ${noradId}`,
    noradId,
    customId: null,
    startMs: 0,
    stopMs: 1,
    colorIndex: 0,
  }
  const response = {
    results: Object.entries(windows).map(([target_id, times]) => ({
      target_id,
      windows: times.map(window),
    })),
    warnings: [],
  } as unknown as AccessResponse
  return { key: `norad:${noradId}`, run, response }
}

const targets: ImagingTarget[] = [
  { kind: 'point', id: 'p', name: 'Point', lat_deg: 0, lon_deg: 0 },
  { kind: 'box', id: 'b', name: 'Box', west_deg: 0, south_deg: 0, east_deg: 1, north_deg: 1 },
]

describe('imaging shots', () => {
  it('keys a shot so that an id split on colons still finds it', () => {
    expect(satSlug('norad:25544')).toBe('norad-25544')
    expect(shotKey('custom:3', 'aoi-1', '2026-09-24T01:00:00Z')).toBe(
      'custom-3:aoi-1:2026-09-24T01:00:00Z',
    )
  })

  it('merges every satellite and target in time order', () => {
    const shots = flattenShots(
      [
        access(1, { p: ['2026-09-24T03:00:00Z'], b: ['2026-09-24T01:00:00Z'] }),
        access(2, { p: ['2026-09-24T02:00:00Z'] }),
      ],
      targets,
      new Set(['norad:1', 'norad:2']),
    )
    expect(shots.map((shot) => [shot.run.name, shot.targetName, shot.box])).toEqual([
      ['SAT 1', 'Box', true],
      ['SAT 2', 'Point', false],
      ['SAT 1', 'Point', false],
    ])
    expect(new Set(shots.map((shot) => shot.key)).size).toBe(3)
  })

  it('tells apart two satellites imaging one target at the same start', () => {
    const at = '2026-09-24T01:00:00Z'
    const shots = flattenShots(
      [access(1, { p: [at] }), access(2, { p: [at] })],
      targets,
      new Set(['norad:1', 'norad:2']),
    )
    expect(shots.map((shot) => shot.key)).toEqual([`norad-1:p:${at}`, `norad-2:p:${at}`])
  })

  it('drops deleted targets and satellites without a run', () => {
    const results = [
      access(1, { p: ['2026-09-24T01:00:00Z'], gone: ['2026-09-24T02:00:00Z'] }),
      access(2, { p: ['2026-09-24T03:00:00Z'] }),
    ]
    const shots = flattenShots(results, targets, new Set(['norad:1']))
    expect(shots.map((shot) => [shot.satKey, shot.targetId])).toEqual([['norad:1', 'p']])
  })
})
