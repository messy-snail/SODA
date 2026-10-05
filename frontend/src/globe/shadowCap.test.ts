import { describe, expect, it } from 'vitest'
import { ringContains } from '../places/tint'
import { capTint, geodeticLatDeg, shadowHalfAngleDeg } from './shadowCap'

const RAD = Math.PI / 180

function separationDeg(lonA: number, latA: number, lonB: number, latB: number): number {
  const cos =
    Math.sin(latA * RAD) * Math.sin(latB * RAD) +
    Math.cos(latA * RAD) * Math.cos(latB * RAD) * Math.cos((lonA - lonB) * RAD)
  return Math.acos(Math.min(Math.max(cos, -1), 1)) / RAD
}

/** Even-odd test of a point against every ring of a cap, as the tile painter fills it. */
function painted(tint: ReturnType<typeof capTint>, lon: number, lat: number): boolean {
  return tint.rings.filter(({ ring }) => ringContains(ring, lon, lat)).length % 2 === 1
}

describe('shadowHalfAngleDeg', () => {
  it('is about 68° at 500 km and shrinks with height', () => {
    expect(shadowHalfAngleDeg(6_378_136.6 + 500_000)).toBeCloseTo(68.02, 1)
    expect(shadowHalfAngleDeg(42_164_000)).toBeCloseTo(8.7, 1)
    expect(shadowHalfAngleDeg(6_378_136.6)).toBe(90)
  })
})

describe('geodeticLatDeg', () => {
  it('matches the geocentric latitude on the equator and at the poles', () => {
    expect(geodeticLatDeg(0, 6_878_000)).toBeCloseTo(0, 9)
    expect(geodeticLatDeg(90, 6_878_000)).toBe(90)
  })

  it('exceeds the geocentric latitude by about 0.18° at 45° in low orbit', () => {
    expect(geodeticLatDeg(45, 6_878_000) - 45).toBeCloseTo(0.178, 2)
    expect(geodeticLatDeg(-45, 6_878_000) + 45).toBeCloseTo(-0.178, 2)
  })
})

describe('capTint', () => {
  it('puts every edge point one radius from the centre', () => {
    const tint = capTint({ centerLonDeg: 30, centerLatDeg: 10, radiusDeg: 40 })
    const edge = tint.lines.find(({ bbox }) => bbox[0] > -180 && bbox[2] < 180)!.ring
    expect(edge).toHaveLength(2 * 361)
    for (let i = 0; i < edge.length; i += 2) {
      expect(separationDeg(edge[i]!, edge[i + 1]!, 30, 10)).toBeCloseTo(40, 6)
    }
  })

  it('fills the inside of a cap that holds no pole', () => {
    const tint = capTint({ centerLonDeg: 30, centerLatDeg: 10, radiusDeg: 40 })
    expect(painted(tint, 30, 10)).toBe(true)
    expect(painted(tint, 30, 45)).toBe(true)
    expect(painted(tint, 30, 55)).toBe(false)
    expect(painted(tint, 80, 10)).toBe(false)
    expect(painted(tint, -150, -10)).toBe(false)
  })

  it('paints both sides of the map for a cap across the antimeridian', () => {
    const tint = capTint({ centerLonDeg: 175, centerLatDeg: 0, radiusDeg: 30 })
    expect(painted(tint, 179, 0)).toBe(true)
    expect(painted(tint, -160, 0)).toBe(true)
    expect(painted(tint, -140, 0)).toBe(false)
    expect(painted(tint, 0, 0)).toBe(false)
  })

  it.each([
    [20, 90],
    [-20, -90],
  ])('closes a night cap centred at latitude %s along the %s pole', (centerLat, pole) => {
    const tint = capTint({ centerLonDeg: -60, centerLatDeg: centerLat, radiusDeg: 90 })
    for (let lon = -179; lon < 180; lon += 30) {
      expect(painted(tint, lon, pole * 0.99)).toBe(true)
      expect(painted(tint, lon, -pole * 0.99)).toBe(false)
    }
    expect(painted(tint, -50, 0)).toBe(true)
    expect(painted(tint, 130, 0)).toBe(false)
    // The stroke follows the terminator only, never the closing run along the pole.
    const lats = tint.lines.flatMap(({ ring }) => ring.filter((_, i) => i % 2 === 1))
    expect(Math.max(...lats.map(Math.abs))).toBeLessThan(89.9)
  })

  it.each([0, 0.01, -0.01, 0.5, -0.5])(
    'stays one clean half of the map at the equinox (centre latitude %s)',
    (centerLat) => {
      const tint = capTint({ centerLonDeg: 0, centerLatDeg: centerLat, radiusDeg: 90 })
      for (const lat of [-80, -40, 0, 40, 80]) {
        expect(painted(tint, 0, lat)).toBe(true)
        expect(painted(tint, 60, lat)).toBe(true)
        expect(painted(tint, -60, lat)).toBe(true)
        expect(painted(tint, 120, lat)).toBe(false)
        expect(painted(tint, -120, lat)).toBe(false)
        expect(painted(tint, 179, lat)).toBe(false)
      }
    },
  )

  it('converts the edge of a shadow cap to geodetic latitude', () => {
    const radiusM = 6_878_000
    const directions = capTint({ centerLonDeg: 0, centerLatDeg: 0, radiusDeg: 45 })
    const geodetic = capTint({ centerLonDeg: 0, centerLatDeg: 0, radiusDeg: 45, radiusM })
    const top = (tint: typeof directions) => Math.max(...tint.rings.map(({ bbox }) => bbox[3]))
    expect(top(directions)).toBeCloseTo(45, 6)
    expect(top(geodetic) - 45).toBeCloseTo(0.178, 2)
  })

  it('is empty for a cap with no area', () => {
    expect(capTint({ centerLonDeg: 0, centerLatDeg: 0, radiusDeg: 0 }).rings).toEqual([])
  })
})
