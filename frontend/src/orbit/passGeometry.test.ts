import { describe, expect, it } from 'vitest'
import { stationFrame } from '../mission/linkWindow'
import {
  derivative,
  dopplerHz,
  lookAngles,
  passSamples,
  requiredElevationDeg,
  skyPoint,
} from './passGeometry'

const SITE = { lat_deg: 36.4, lon_deg: 127.4, alt_m: 80 }
const SPEED_M_S = 7500
const HEIGHT_M = 500_000
const STEP_S = 10

/** A point `east`, `north` and `up` metres from the site, in ITRS. */
function offset(east: number, north: number, up: number): [number, number, number] {
  const frame = stationFrame(SITE)
  return [0, 1, 2].map(
    (i) => frame.position[i]! + east * frame.east[i]! + north * frame.north[i]! + up * frame.up[i]!,
  ) as [number, number, number]
}

/** A straight overhead fly-by heading north, sampled like `Pass.track_fixed_m`. */
function flyby() {
  const times = Array.from({ length: 61 }, (_, i) => (i - 30) * STEP_S)
  const track = times.flatMap((t) =>
    offset(0, SPEED_M_S * t, HEIGHT_M).map((v) => Math.round(v * 10) / 10),
  )
  return { times, contact: { aosMs: 0, losMs: 600_000, track } }
}

describe('lookAngles', () => {
  const frame = stationFrame(SITE)

  it('puts a point straight up at the zenith', () => {
    const look = lookAngles(frame, ...offset(0, 0, HEIGHT_M))
    expect(look.elevationDeg).toBeCloseTo(90, 6)
    expect(look.rangeKm).toBeCloseTo(500, 6)
  })

  it('measures azimuth clockwise from north', () => {
    expect(lookAngles(frame, ...offset(0, 1000, 10)).azimuthDeg).toBeCloseTo(0, 6)
    expect(lookAngles(frame, ...offset(1000, 0, 10)).azimuthDeg).toBeCloseTo(90, 6)
    expect(lookAngles(frame, ...offset(0, -1000, 10)).azimuthDeg).toBeCloseTo(180, 6)
    expect(lookAngles(frame, ...offset(-1000, 0, 10)).azimuthDeg).toBeCloseTo(270, 6)
  })

  it('reads elevation off the local horizon', () => {
    expect(lookAngles(frame, ...offset(1000, 0, 1000)).elevationDeg).toBeCloseTo(45, 6)
  })
})

describe('derivative', () => {
  it('is exact for a cubic, edges included', () => {
    const xs = Array.from({ length: 9 }, (_, i) => i * 0.5)
    const got = derivative(
      xs.map((x) => x ** 3 - 2 * x),
      0.5,
    )
    xs.forEach((x, i) => expect(got[i]).toBeCloseTo(3 * x * x - 2, 9))
  })

  it('falls back to plain differences on a short series', () => {
    expect(derivative([0, 2, 4], 1)).toEqual([2, 2, 2])
    expect(derivative([5], 1)).toEqual([0])
  })
})

describe('passSamples', () => {
  it('matches the analytic range rate of a straight fly-by', () => {
    const { times, contact } = flyby()
    const samples = passSamples(contact, SITE)
    expect(samples).toHaveLength(times.length)
    times.forEach((t, i) => {
      const along = SPEED_M_S * t
      const rate = (SPEED_M_S * along) / Math.hypot(along, HEIGHT_M) / 1000
      // Within 2 m/s everywhere, the peak included.
      expect(Math.abs(samples[i]!.rangeRateKmS - rate)).toBeLessThan(0.002)
    })
  })

  it('rises in the south, peaks overhead and sets in the north', () => {
    const samples = passSamples(flyby().contact, SITE)
    expect(samples[0]!.azimuthDeg).toBeCloseTo(180, 3)
    expect(samples[30]!.elevationDeg).toBeCloseTo(90, 3)
    // Due north, on either side of the 0/360 seam.
    expect(Math.cos((samples[60]!.azimuthDeg * Math.PI) / 180)).toBeCloseTo(1, 9)
    expect(samples[0]!.ms).toBe(0)
    expect(samples[60]!.ms).toBe(600_000)
  })

  it('has no samples without a track', () => {
    expect(passSamples({ aosMs: 0, losMs: 1000, track: [] }, SITE)).toEqual([])
    expect(passSamples({ aosMs: 0, losMs: 1000, track: [1, 2, 3] }, SITE)).toEqual([])
  })
})

describe('dopplerHz', () => {
  it('is positive on approach, zero at the peak and negative after', () => {
    const samples = passSamples(flyby().contact, SITE)
    const shift = (i: number) => dopplerHz(samples[i]!.rangeRateKmS, 2.2e9)
    expect(shift(0)).toBeGreaterThan(40_000)
    expect(Math.abs(shift(30))).toBeLessThan(20)
    expect(shift(60)).toBeCloseTo(-shift(0), 0)
  })
})

describe('skyPoint', () => {
  it('puts north up, east right and the zenith in the middle', () => {
    const near = (point: [number, number], x: number, y: number) => {
      expect(point[0]).toBeCloseTo(x, 9)
      expect(point[1]).toBeCloseTo(y, 9)
    }
    near(skyPoint(0, 0), 0, -1)
    near(skyPoint(90, 0), 1, 0)
    near(skyPoint(180, 45), 0, 0.5)
    near(skyPoint(123, 90), 0, 0)
  })

  it('keeps directions below the horizon on the rim', () => {
    expect(Math.hypot(...skyPoint(40, -5))).toBeCloseTo(1, 9)
  })
})

describe('requiredElevationDeg', () => {
  const mask = [
    { az_deg: 180, min_elev_deg: 20 },
    { az_deg: 0, min_elev_deg: 10 },
  ]

  it('is the minimum elevation without a mask', () => {
    expect(requiredElevationDeg(5, [], 77)).toBe(5)
  })

  it('interpolates between vertices and across the wrap', () => {
    expect(requiredElevationDeg(0, mask, 90)).toBeCloseTo(15, 9)
    expect(requiredElevationDeg(0, mask, 270)).toBeCloseTo(15, 9)
    expect(requiredElevationDeg(0, mask, 180)).toBeCloseTo(20, 9)
    expect(requiredElevationDeg(0, mask, 360)).toBeCloseTo(10, 9)
  })

  it('never drops below the minimum elevation', () => {
    expect(requiredElevationDeg(12, mask, 0)).toBe(12)
  })
})
