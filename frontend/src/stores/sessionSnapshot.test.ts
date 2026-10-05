import { describe, expect, it } from 'vitest'
import {
  loadSnapshot,
  sanitizeSnapshot,
  saveSnapshot,
  SESSION_STORAGE_KEY,
} from './sessionSnapshot'

const camera = {
  lon_deg: 127,
  lat_deg: 36,
  height_m: 2e6,
  heading_rad: 0,
  pitch_rad: -1.2,
  roll_rad: 0,
}

const full = {
  camera,
  sceneMode: '2d',
  clock: { currentMs: 1_700_000_000_000, playing: false, multiplier: 60 },
  activeTool: 'passes',
  viewTab: 'places',
  basket: ['norad:25544', 'custom:2', 'state:4', 'oem:5'],
  stationIds: [3, 5],
  swathToggles: { nadir: false, cone: true },
  comparison: false,
  trackedRunId: 'run-1',
  savedAtMs: 5,
}

describe('sanitizeSnapshot', () => {
  it('keeps a well-formed snapshot as is', () => {
    expect(sanitizeSnapshot(full)).toEqual(full)
  })

  it('drops the fields that do not check out', () => {
    const snapshot = sanitizeSnapshot({
      ...full,
      camera: { ...camera, lat_deg: 120 },
      sceneMode: 'vr',
      clock: { currentMs: 'now', playing: true, multiplier: 1 },
      activeTool: 'nope',
      basket: ['norad:1', 'bad', 7],
      stationIds: [1, 'x', 2.5],
      swathToggles: { nadir: 'on', cone: false },
      trackedRunId: 7,
    })
    expect(snapshot).toMatchObject({
      camera: null,
      sceneMode: '3d',
      clock: null,
      activeTool: null,
      basket: ['norad:1'],
      stationIds: [1],
      swathToggles: { cone: false },
      trackedRunId: null,
    })
  })

  it('reads the single selection older snapshots kept', () => {
    const old: Record<string, unknown> = { ...full }
    delete old.basket
    expect(sanitizeSnapshot({ ...old, selectedNorad: 40536 })!.basket).toEqual(['norad:40536'])
    expect(sanitizeSnapshot({ ...old, selectedNorad: 1, selectedCustom: 3 })!.basket).toEqual([
      'custom:3',
    ])
  })

  it('reopens a former rail tool as a tab of the view tool', () => {
    expect(sanitizeSnapshot({ ...full, activeTool: 'markers', viewTab: 'layers' })).toMatchObject({
      activeTool: 'view',
      viewTab: 'markers',
    })
    expect(sanitizeSnapshot({ ...full, viewTab: 'weather' })?.viewTab).toBeNull()
  })

  it('reopens the former propagation tool as the satellite tool it was merged into', () => {
    expect(sanitizeSnapshot({ ...full, activeTool: 'propagate' })?.activeTool).toBe('satellite')
    expect(sanitizeSnapshot({ ...full, activeTool: 'constructor' })?.activeTool).toBeNull()
  })

  it('reopens the former mission tool as the imaging tool, its first tab', () => {
    expect(sanitizeSnapshot({ ...full, activeTool: 'mission' })?.activeTool).toBe('imaging')
    expect(sanitizeSnapshot({ ...full, activeTool: 'tmtc' })?.activeTool).toBe('tmtc')
  })

  it('rejects non-objects', () => {
    expect(sanitizeSnapshot(null)).toBeNull()
    expect(sanitizeSnapshot('x')).toBeNull()
  })
})

describe('loadSnapshot / saveSnapshot', () => {
  it('round-trips and tolerates broken storage', () => {
    const entries = new Map<string, string>()
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
    }
    expect(loadSnapshot(storage)).toBeNull()
    saveSnapshot(storage, sanitizeSnapshot(full)!)
    expect(loadSnapshot(storage)).toEqual(full)
    entries.set(SESSION_STORAGE_KEY, '{')
    expect(loadSnapshot(storage)).toBeNull()
    expect(loadSnapshot(null)).toBeNull()
  })
})
