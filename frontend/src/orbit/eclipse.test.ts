import { describe, expect, it } from 'vitest'
import { eclipsedAt, eclipseGradient, eclipseIntervals, radiusAtM } from './eclipse'

describe('eclipseIntervals', () => {
  it('returns the pairs of a well-formed response', () => {
    expect(eclipseIntervals({ eclipse_s: [10, 20, 50, 60.5] })).toEqual([10, 20, 50, 60.5])
    expect(eclipseIntervals({ eclipse_s: [] })).toEqual([])
  })

  it('treats missing or malformed data as no data', () => {
    expect(eclipseIntervals({})).toBeNull()
    expect(eclipseIntervals({ eclipse_s: null })).toBeNull()
    expect(eclipseIntervals({ eclipse_s: [10, 20, 30] })).toBeNull()
    expect(eclipseIntervals({ eclipse_s: [20, 10] })).toBeNull()
    expect(eclipseIntervals({ eclipse_s: [10, NaN] })).toBeNull()
    expect(eclipseIntervals({ eclipse_s: 'x' as unknown as number[] })).toBeNull()
  })
})

describe('eclipsedAt', () => {
  it('is true inside an interval, ends included', () => {
    const intervals = [10, 20, 50, 60]
    const inside = [5, 10, 15, 20, 30, 55, 61].map((value) => eclipsedAt(intervals, value))
    expect(inside).toEqual([false, true, true, true, false, true, false])
  })
})

describe('radiusAtM', () => {
  const data = { count: 3, step_s: 60, fixed_m: [7000, 0, 0, 0, 7100, 0, 0, 0, null] }

  it('interpolates between samples', () => {
    expect(radiusAtM(data, 0)).toBe(7000)
    expect(radiusAtM(data, 30)).toBe(7050)
    expect(radiusAtM(data, 60)).toBe(7100)
  })

  it('is null outside the run and beside a failed sample', () => {
    expect(radiusAtM(data, -1)).toBeNull()
    expect(radiusAtM(data, 121)).toBeNull()
    expect(radiusAtM(data, 90)).toBeNull()
    expect(radiusAtM(data, NaN)).toBeNull()
  })
})

describe('eclipseGradient', () => {
  it('is none without a visible eclipse', () => {
    expect(eclipseGradient([], 0, 1000, '#000000')).toBe('none')
    expect(eclipseGradient([2000, 3000], 0, 1000, '#000000')).toBe('none')
    expect(eclipseGradient([100, 200], 500, 500, '#000000')).toBe('none')
  })

  it('draws each eclipse as a hard-edged band, clipped to the range', () => {
    expect(eclipseGradient([250, 500, 900, 1200], 0, 1000, '#112233')).toBe(
      'linear-gradient(to right, ' +
        'transparent 0.000%, transparent 25.000%, ' +
        '#112233b3 25.000%, #112233b3 50.000%, ' +
        'transparent 50.000%, transparent 90.000%, ' +
        '#112233b3 90.000%, #112233b3 100.000%)',
    )
  })

  it('falls back to bins shaded by the eclipsed share past the band limit', () => {
    // Four eclipses but room for two bands: the halves of the range are 50% and 62.5% dark.
    const gradient = eclipseGradient([0, 100, 200, 300, 500, 600, 650, 900], 0, 800, '#112233', 2)
    expect(gradient).toBe(
      'linear-gradient(to right, ' +
        '#1122335a 0.000%, #1122335a 50.000%, ' +
        '#11223370 50.000%, #11223370 100.000%)',
    )
  })
})
