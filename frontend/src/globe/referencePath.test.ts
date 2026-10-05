import { describe, expect, it } from 'vitest'
import type { OrbitRun } from '../stores/runs'
import { Cartesian3 } from 'cesium'
import { referenceSegments, referenceTarget, segmentPositions } from './referencePath'
import { presets } from '../theme/presets'

const run = (id: string, visible = true) => ({ id, visible }) as OrbitRun

describe('reference target', () => {
  it('keeps explicit hidden selections and falls back only when nothing is selected', () => {
    const first = run('first')
    const hidden = run('hidden', false)
    const last = run('last')
    expect(referenceTarget([first, hidden, last], hidden.id)).toBe(hidden)
    expect(referenceTarget([first, hidden, last], first.id)).toBe(first)
    expect(referenceTarget([first, hidden, last], null)).toBe(last)
    expect(referenceTarget([first, hidden], null)).toBe(first)
    expect(referenceTarget([hidden], null)).toBeNull()
    expect(referenceTarget([], null)).toBeNull()
  })
})

describe('future inertial reference interval', () => {
  const segments = (now: number, period = 4, ranges: [number, number][] = [[0, 20]]) =>
    referenceSegments(0, 1_200_000, 60_000, period, now * 60_000, ranges)
  it('includes exact fractional endpoints and limits to one revolution', () => {
    expect(segments(3.5)).toEqual([[3.5, 4, 5, 6, 7, 7.5]])
    expect(segments(3, 2)).toEqual([[3, 4, 5]])
  })
  it('clips to the propagation end and hides outside the available interval', () => {
    expect(segments(18)).toEqual([[18, 19, 20]])
    expect(segments(20)).toEqual([])
    expect(segments(21)).toEqual([])
    expect(segments(-1)).toEqual([])
    expect(segments(3, NaN)).toEqual([])
  })
  it('never bridges invalid sample gaps', () => {
    expect(
      segments(3.5, 10, [
        [0, 4],
        [7, 10],
      ]),
    ).toEqual([
      [3.5, 4],
      [7, 8, 9, 10],
    ])
    expect(
      segments(5, 1, [
        [0, 4],
        [7, 10],
      ]),
    ).toEqual([])
  })
  it('provides distinct frame colours and a reference colour for every theme', () => {
    for (const preset of presets) {
      expect(preset.colors['frame-fixed']).not.toBe(preset.colors['frame-inertial'])
      expect(preset.globe.inertialReference).toMatch(/^#[\da-f]{6}$/i)
    }
  })
})

describe('segment positions', () => {
  // Samples one metre apart on the x axis, so a lerp result reads as its own index.
  const positions = Array.from({ length: 5 }, (_, i) => new Cartesian3(i, 0, 0))

  it('passes integer indices straight through', () => {
    expect(segmentPositions([1, 2, 3], positions)).toEqual([
      positions[1],
      positions[2],
      positions[3],
    ])
  })

  it('interpolates the fractional endpoints referenceSegments produces', () => {
    const [start, , end] = segmentPositions([1.25, 2, 3.5], positions)

    expect(start!.x).toBeCloseTo(1.25)
    expect(end!.x).toBeCloseTo(3.5)
  })

  it('returns new vectors for fractional indices and shared ones for integers', () => {
    const [fractional, integer] = segmentPositions([0.5, 2], positions)

    expect(fractional).not.toBe(positions[0])
    expect(integer).toBe(positions[2])
  })

  it('handles an empty segment', () => {
    expect(segmentPositions([], positions)).toEqual([])
  })
})
