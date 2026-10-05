import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME,
  homeDestination,
  paddedBbox,
  pointForBbox,
  sanitizePoint,
  wrapLon,
} from './camera'

describe('homeDestination', () => {
  it('keeps the 3D home as is', () => {
    expect(homeDestination(DEFAULT_HOME, '3d')).toEqual(DEFAULT_HOME)
  })

  it('centres a whole-Earth home on the equator in 2D, with double the height', () => {
    expect(homeDestination(DEFAULT_HOME, '2d')).toEqual({
      lon_deg: 127.8,
      lat_deg: 0,
      height_m: 40_000_000,
    })
  })

  it('keeps the latitude of a regional home in 2D', () => {
    const home = { lon_deg: 127.4, lat_deg: 36.3, height_m: 1_000_000 }
    expect(homeDestination(home, '2d')).toEqual({ ...home, height_m: 2_000_000 })
  })
})

describe('wrapLon', () => {
  it('wraps into [-180, 180)', () => {
    expect(wrapLon(190)).toBe(-170)
    expect(wrapLon(-190)).toBe(170)
    expect(wrapLon(180)).toBe(-180)
    expect(wrapLon(45)).toBe(45)
  })
})

describe('paddedBbox', () => {
  it('pads each side by a fraction of the span', () => {
    const [w, s, e, n] = paddedBbox([120, 30, 130, 40], 0.1)
    expect([w, s, e, n]).toEqual([119, 29, 131, 41])
  })

  it('widens a tiny extent to the minimum span', () => {
    const [w, s, e, n] = paddedBbox([103.6, 1.2, 104, 1.5])
    expect(e - w).toBeCloseTo(1.5)
    expect(n - s).toBeCloseTo(1.5)
  })

  it('keeps east < west across the antimeridian', () => {
    const [w, , e] = paddedBbox([170, -20, -170, -10], 0.1)
    expect(w).toBeCloseTo(168)
    expect(e).toBeCloseTo(-168)
  })

  it('falls back to the whole longitude band when too wide, and clamps latitude', () => {
    const [w, s, e, n] = paddedBbox([-179, 80, 179, 88], 0.5)
    expect([w, e, n]).toEqual([-180, 180, 90])
    expect(s).toBeCloseTo(76)
  })
})

describe('pointForBbox', () => {
  it('centres on the label and scales height with the extent', () => {
    const small = pointForBbox([126, 34, 130, 39], [128, 36])
    const large = pointForBbox([-125, 25, -67, 49])
    expect(small.lon_deg).toBe(128)
    expect(small.lat_deg).toBe(36)
    expect(large.height_m).toBeGreaterThan(small.height_m)
    expect(large.lon_deg).toBeCloseTo(-96)
  })

  it('handles an extent across the antimeridian', () => {
    expect(pointForBbox([170, -20, -170, -10]).lon_deg).toBeCloseTo(-180)
  })
})

describe('sanitizePoint', () => {
  it('clamps into the accepted ranges', () => {
    expect(sanitizePoint({ lon_deg: 200, lat_deg: 95, height_m: 1 })).toEqual({
      lon_deg: -160,
      lat_deg: 90,
      height_m: 200,
    })
  })

  it('rejects non-finite or missing values', () => {
    expect(sanitizePoint({ lon_deg: 0, lat_deg: Number.NaN, height_m: 1e6 })).toBeNull()
    expect(sanitizePoint({ lon_deg: 0, lat_deg: 0 })).toBeNull()
    expect(sanitizePoint(null)).toBeNull()
  })
})
