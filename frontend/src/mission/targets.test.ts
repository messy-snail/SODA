import { describe, expect, it } from 'vitest'
import {
  accessReason,
  mergeDiagnoses,
  boxFromCorners,
  boxWidthDeg,
  sanitizeTarget,
  targetCenter,
  toRequest,
  type BoxTarget,
  wrapLon,
} from './targets'

describe('boxFromCorners', () => {
  it('orders corners into west-south-east-north', () => {
    expect(boxFromCorners({ lon_deg: 130, lat_deg: 38 }, { lon_deg: 125, lat_deg: 33 })).toEqual({
      west_deg: 125,
      south_deg: 33,
      east_deg: 130,
      north_deg: 38,
    })
  })

  it('takes the narrow way across the date line', () => {
    const box = boxFromCorners({ lon_deg: 175, lat_deg: -20 }, { lon_deg: -175, lat_deg: -10 })
    expect(box).toMatchObject({ west_deg: 175, east_deg: -175 })
    expect(boxWidthDeg(box)).toBe(10)
    const reversed = boxFromCorners({ lon_deg: -175, lat_deg: -10 }, { lon_deg: 175, lat_deg: -20 })
    expect(reversed).toEqual(box)
  })
})

describe('targetCenter', () => {
  it('finds the middle of a box across the date line', () => {
    const box: BoxTarget = {
      kind: 'box',
      id: 'b',
      name: 'b',
      west_deg: 170,
      south_deg: 0,
      east_deg: -170,
      north_deg: 10,
    }
    expect(Math.abs(targetCenter(box).lon_deg)).toBe(180)
    expect(targetCenter(box).lat_deg).toBe(5)
  })
})

describe('wrapLon', () => {
  it('folds into [-180, 180)', () => {
    expect(wrapLon(190)).toBe(-170)
    expect(wrapLon(-190)).toBe(170)
    expect(wrapLon(45)).toBe(45)
  })
})

describe('sanitizeTarget', () => {
  it('keeps valid points and boxes and sends only request fields', () => {
    const point = sanitizeTarget({
      kind: 'point',
      id: 'p',
      name: ' Seoul ',
      lat_deg: 37,
      lon_deg: 127,
    })
    expect(point).toEqual({ kind: 'point', id: 'p', name: 'Seoul', lat_deg: 37, lon_deg: 127 })
    expect(toRequest(point!)).toEqual({ id: 'p', lat_deg: 37, lon_deg: 127 })
    const box = sanitizeTarget({
      kind: 'box',
      id: 'b',
      name: 'Korea',
      west_deg: 125,
      south_deg: 33,
      east_deg: 130,
      north_deg: 38,
    })
    expect(toRequest(box!)).toEqual({
      id: 'b',
      west_deg: 125,
      south_deg: 33,
      east_deg: 130,
      north_deg: 38,
    })
  })

  it('drops malformed entries', () => {
    expect(sanitizeTarget(null)).toBeNull()
    expect(sanitizeTarget({ kind: 'point', id: 'p', name: '', lat_deg: 0, lon_deg: 0 })).toBeNull()
    expect(
      sanitizeTarget({ kind: 'point', id: 'p', name: 'x', lat_deg: 91, lon_deg: 0 }),
    ).toBeNull()
    expect(
      sanitizeTarget({
        kind: 'box',
        id: 'b',
        name: 'x',
        west_deg: 0,
        south_deg: 10,
        east_deg: 5,
        north_deg: 10,
      }),
    ).toBeNull()
  })
})

describe('accessReason', () => {
  const none = { passes: 0, dark: 0, best_sun_elev_deg: null, nearest_roll_deg: null }

  it('reports windows, and passes lost to the Sun beside them', () => {
    expect(accessReason(3, { ...none, passes: 5, dark: 2, best_sun_elev_deg: 4 })).toEqual({
      kind: 'found',
      count: 3,
      dark: 2,
    })
  })

  it('tells too dark from out of reach from never passing', () => {
    const dark = { passes: 2, dark: 2, best_sun_elev_deg: 4.2, nearest_roll_deg: 12 }
    expect(accessReason(0, dark)).toEqual({ kind: 'dark', dark: 2, sunDeg: 4.2 })
    expect(accessReason(0, { ...none, nearest_roll_deg: 42 })).toEqual({
      kind: 'outOfReach',
      rollDeg: 42,
    })
    expect(accessReason(0, none)).toEqual({ kind: 'noPass' })
  })
})

describe('mergeDiagnoses', () => {
  it('adds the passes of every satellite and keeps the best any of them did', () => {
    const merged = mergeDiagnoses([
      { passes: 2, dark: 2, best_sun_elev_deg: 4.2, nearest_roll_deg: 12 },
      { passes: 1, dark: 0, best_sun_elev_deg: null, nearest_roll_deg: -8 },
      { passes: 0, dark: 0, best_sun_elev_deg: null, nearest_roll_deg: null },
    ])
    expect(merged).toEqual({ passes: 3, dark: 2, best_sun_elev_deg: 4.2, nearest_roll_deg: -8 })
    // No satellite with a window: the reason is the darkness that cost two passes.
    expect(accessReason(0, merged)).toEqual({ kind: 'dark', dark: 2, sunDeg: 4.2 })
  })

  it('stays empty when no satellite ever passed', () => {
    const none = { passes: 0, dark: 0, best_sun_elev_deg: null, nearest_roll_deg: null }
    expect(mergeDiagnoses([none, none])).toEqual(none)
    expect(mergeDiagnoses([])).toEqual(none)
  })
})
