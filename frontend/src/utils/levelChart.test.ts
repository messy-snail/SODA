import { describe, expect, it } from 'vitest'
import { thinExtremes } from './levelChart'

const wave = Array.from({ length: 10_000 }, (_, i) => ({ ms: i, value: Math.sin(i / 7) }))

describe('thinExtremes', () => {
  it('leaves a short series alone', () => {
    const points = wave.slice(0, 50)
    expect(thinExtremes(points, 100)).toEqual(points)
  })

  it('keeps the envelope of a series that swings many times', () => {
    const thin = thinExtremes(wave, 200)
    expect(thin.length).toBeLessThanOrEqual(200)
    expect(Math.max(...thin.map((p) => p.value))).toBeGreaterThan(0.999)
    expect(Math.min(...thin.map((p) => p.value))).toBeLessThan(-0.999)
  })

  it('keeps the points in time order', () => {
    const times = thinExtremes(wave, 200).map((p) => p.ms)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
