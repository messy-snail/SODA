import { describe, expect, it } from 'vitest'
import { pickScaleBar, scaleLabel, viewBounds } from './scaleBar'

describe('pickScaleBar', () => {
  it('picks the longest 1-2-5 length that fits', () => {
    // 120 px at 10 m/px is 1200 m, so 1 km fits and 2 km does not.
    expect(pickScaleBar(10)).toEqual({ length_m: 1000, width_px: 100 })
    expect(pickScaleBar(20)).toEqual({ length_m: 2000, width_px: 100 })
    expect(pickScaleBar(50)).toEqual({ length_m: 5000, width_px: 100 })
    expect(pickScaleBar(3)).toEqual({ length_m: 200, width_px: 67 })
  })

  it('never draws wider than the limit', () => {
    for (const metresPerPx of [0.07, 0.3, 1.9, 42, 777, 15_000, 123_456]) {
      const bar = pickScaleBar(metresPerPx, 120)!
      expect(bar.width_px).toBeLessThanOrEqual(120)
      // A 1-2-5 ladder never has to settle for less than 40% of the room.
      expect(bar.width_px).toBeGreaterThanOrEqual(48)
      expect([1, 2, 5]).toContain(Number(String(bar.length_m.toExponential()).charAt(0)))
    }
  })

  it('stays exact below a metre', () => {
    expect(pickScaleBar(0.005)).toEqual({ length_m: 0.5, width_px: 100 })
  })

  it('has nothing to show for an unusable resolution', () => {
    expect(pickScaleBar(Number.NaN)).toBeNull()
    expect(pickScaleBar(0)).toBeNull()
    expect(pickScaleBar(-3)).toBeNull()
    expect(pickScaleBar(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('scaleLabel', () => {
  it('switches to kilometres at one kilometre', () => {
    expect(scaleLabel(500)).toEqual({ value: 500, unit: 'm' })
    expect(scaleLabel(1000)).toEqual({ value: 1, unit: 'km' })
    expect(scaleLabel(2_000_000)).toEqual({ value: 2000, unit: 'km' })
    expect(scaleLabel(0.5)).toEqual({ value: 0.5, unit: 'm' })
  })
})

describe('viewBounds', () => {
  it('boxes the points', () => {
    expect(
      viewBounds([
        [126.5, 37.1],
        [127.2, 37.9],
        [126.9, 36.8],
      ]),
    ).toEqual([126.5, 36.8, 127.2, 37.9])
  })

  it('gives up on a view across the antimeridian', () => {
    expect(
      viewBounds([
        [179.5, 10],
        [-179.5, 11],
      ]),
    ).toBeNull()
    expect(viewBounds([])).toBeNull()
  })
})
