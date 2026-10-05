import { describe, expect, it } from 'vitest'
import { sunSubpoint } from './sunDirection'

/** `sun_unit_itrs` of the backend (Skyfield + DE421) at each time: [UTC, lon°, lat°]. */
const DE421: [string, number, number][] = [
  ['2024-01-01T12:00:00Z', 0.8351, -23.0187],
  ['2024-03-20T03:06:00Z', 135.36, 0.0023],
  ['2024-06-20T20:51:00Z', -132.2975, 23.4382],
  ['2025-09-22T18:19:00Z', -96.609, -0.0022],
  ['2026-10-01T00:00:00Z', 177.4593, -3.1118],
  ['2030-12-21T06:00:00Z', 89.4897, -23.4328],
]

describe('sunSubpoint', () => {
  it.each(DE421)('stays within 0.02° of DE421 at %s', (utc, lon, lat) => {
    const sun = sunSubpoint(Date.parse(utc))
    expect(Math.abs(sun.lat_deg - lat)).toBeLessThan(0.02)
    const delta = ((sun.lon_deg - lon + 540) % 360) - 180
    expect(Math.abs(delta) * Math.cos((lat * Math.PI) / 180)).toBeLessThan(0.02)
  })

  it('keeps the longitude in [-180, 180) and moves west 15° an hour', () => {
    const start = Date.parse('2026-10-01T00:00:00Z')
    for (let hour = 0; hour < 48; hour++) {
      const { lon_deg } = sunSubpoint(start + hour * 3_600_000)
      expect(lon_deg).toBeGreaterThanOrEqual(-180)
      expect(lon_deg).toBeLessThan(180)
    }
    const a = sunSubpoint(start).lon_deg
    const b = sunSubpoint(start + 3_600_000).lon_deg
    expect(((a - b + 540) % 360) - 180).toBeCloseTo(15, 0)
  })
})
