import { describe, expect, it } from 'vitest'
import { crossTrackEdges, WGS84_A, WGS84_B, type Vec3 } from './sensorFan'

const MEAN_RADIUS_M = 6_371_008.8
const deg = Math.PI / 180

/** Full FOV that images `swathKm` at nadir from `altitudeKm` (sphere), as in swath.py. */
function fovFromSwathKm(swathKm: number, altitudeKm: number) {
  const half = (swathKm * 1000) / 2 / MEAN_RADIUS_M
  const ratio = (MEAN_RADIUS_M + altitudeKm * 1000) / MEAN_RADIUS_M
  return 2 * Math.atan2(Math.sin(half), ratio - Math.cos(half))
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** Ellipsoid equation value; 1 on the WGS84 surface. */
const onEllipsoid = (p: Vec3) => (p[0] ** 2 + p[1] ** 2) / WGS84_A ** 2 + p[2] ** 2 / WGS84_B ** 2

// Equatorial circular orbit, moving east at 500 km.
const h = 500_000
const position: Vec3 = [WGS84_A + h, 0, 0]
const velocity: Vec3 = [0, 7600, 0]

describe('crossTrackEdges', () => {
  it('images the requested nadir width', () => {
    const fov = fovFromSwathKm(12, h / 1000)
    const { left, right } = crossTrackEdges(position, velocity, 0, 0, fov / 2)
    expect(distance(left, right) / 1000).toBeCloseTo(12, 1)
  })

  it('puts the edges on the ground, perpendicular to the track', () => {
    const { left, right } = crossTrackEdges(position, velocity, 0, 0, 10 * deg)
    for (const p of [left, right]) expect(onEllipsoid(p)).toBeCloseTo(1, 9)
    // Moving east at the equator, cross-track is north-south; the along-track (y) offset is nil.
    expect(Math.abs(left[1])).toBeLessThan(1e-6)
    expect(Math.sign(left[2])).toBe(-Math.sign(right[2]))
  })

  it('matches 2h·tanθ for a small roll', () => {
    const { left, right } = crossTrackEdges(position, velocity, 0, 0, 5 * deg)
    expect(distance(left, right)).toBeCloseTo(2 * h * Math.tan(5 * deg), -3)
  })

  it('clamps rays beyond the limb to the horizon', () => {
    const { left } = crossTrackEdges(position, velocity, 0, 0, 89 * deg)
    expect(onEllipsoid(left)).toBeCloseTo(1, 9)
    const limb = Math.asin(WGS84_A / (WGS84_A + h))
    const clamped = crossTrackEdges(position, velocity, 0, 0, limb - 0.2 * deg)
    expect(distance(left, clamped.left)).toBeLessThan(1)
  })
})
