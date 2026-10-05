import { describe, expect, it } from 'vitest'
import { elevationDeg, elevationSpan, stationFrame, usableWindow } from './linkWindow'

const RAD = Math.PI / 180
const EQUATOR_M = 6378137
const SITE = { lat_deg: 0, lon_deg: 0, alt_m: 0 }

/**
 * An equatorial pass straight over a site on the equator: the satellite moves along the
 * equator at `radius`, so its elevation has a closed form.
 */
function overheadPass(stepS: number) {
  const radius = EQUATOR_M + 500_000
  const rate = (2 * Math.PI) / 5700 // rad/s relative to the ground
  const horizon = Math.acos(EQUATOR_M / radius)
  /** Seconds from the peak at which the elevation is `deg`, on the setting side. */
  const offsetS = (deg: number) =>
    (Math.acos((EQUATOR_M / radius) * Math.cos(deg * RAD)) - deg * RAD) / rate
  const halfS = horizon / rate
  const count = Math.round((2 * halfS) / stepS) + 1
  const track: number[] = []
  for (let i = 0; i < count; i++) {
    const angle = -horizon + (2 * horizon * i) / (count - 1)
    track.push(radius * Math.cos(angle), radius * Math.sin(angle), 0)
  }
  const tcaMs = 1_000_000_000
  return {
    contact: {
      aosMs: tcaMs - halfS * 1000,
      losMs: tcaMs + halfS * 1000,
      maxElevationDeg: 90,
      track,
    },
    tcaMs,
    offsetS,
  }
}

describe('stationFrame and elevationDeg', () => {
  it('puts a site on the ellipsoid', () => {
    const equator = stationFrame(SITE)
    expect(equator.position[0]).toBeCloseTo(EQUATOR_M, 3)
    expect(equator.position[1]).toBeCloseTo(0, 6)
    const pole = stationFrame({ lat_deg: 90, lon_deg: 0, alt_m: 100 })
    expect(pole.position[2]).toBeCloseTo(6356752.314 + 100, 2)
    expect(pole.up[2]).toBeCloseTo(1, 12)
  })

  it('reads 90° overhead and 0° on the horizon plane', () => {
    const frame = stationFrame(SITE)
    expect(elevationDeg(frame, EQUATOR_M + 500_000, 0, 0)).toBeCloseTo(90, 6)
    expect(elevationDeg(frame, EQUATOR_M, 800_000, 0)).toBeCloseTo(0, 6)
    expect(elevationDeg(frame, EQUATOR_M + 1000, 0, 1000)).toBeCloseTo(45, 6)
  })
})

describe('elevationSpan', () => {
  it('finds both crossings of a 10 s track to within a second', () => {
    const { contact, tcaMs, offsetS } = overheadPass(10)
    for (const threshold of [5, 10, 30]) {
      const span = elevationSpan(contact, SITE, 0, threshold)!
      expect(Math.abs(span.startMs - (tcaMs - offsetS(threshold) * 1000))).toBeLessThan(1000)
      expect(Math.abs(span.endMs - (tcaMs + offsetS(threshold) * 1000))).toBeLessThan(1000)
    }
    // A higher threshold leaves a shorter span.
    const low = elevationSpan(contact, SITE, 0, 5)!
    const high = elevationSpan(contact, SITE, 0, 30)!
    expect(high.endMs - high.startMs).toBeLessThan(low.endMs - low.startMs)
  })

  it('keeps the whole pass at or below the elevation it was predicted with', () => {
    const { contact } = overheadPass(10)
    expect(elevationSpan(contact, SITE, 10, 5)).toEqual({
      startMs: contact.aosMs,
      endMs: contact.losMs,
    })
  })

  it('has no span when the pass peaks below the threshold', () => {
    const { contact } = overheadPass(10)
    expect(elevationSpan({ ...contact, maxElevationDeg: 4 }, SITE, 0, 5)).toBeNull()
  })

  it('falls back to the whole pass without a track', () => {
    const { contact } = overheadPass(10)
    expect(elevationSpan({ ...contact, track: [] }, SITE, 0, 5)).toEqual({
      startMs: contact.aosMs,
      endMs: contact.losMs,
    })
  })
})

describe('usableWindow', () => {
  const gate = { startMs: 10_000, endMs: 70_000 }

  it('starts after the lock and stays inside the run', () => {
    expect(usableWindow(gate, 15, 0, 100_000)).toEqual({ startMs: 25_000, endMs: 70_000 })
    expect(usableWindow(gate, 15, 40_000, 60_000)).toEqual({ startMs: 40_000, endMs: 60_000 })
  })

  it('is null when the lock takes the whole gate, or there is no gate', () => {
    expect(usableWindow(gate, 60, 0, 100_000)).toBeNull()
    expect(usableWindow(null, 0, 0, 100_000)).toBeNull()
  })
})
