import { Cartesian3, Color, Matrix4 } from 'cesium'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrbitRun } from '../stores/runs'
import { createOrbitTrail, splitByEclipse, splitByTrust } from './orbitTrail'

// jsdom omits this browser type, which Cesium checks while inferring material uniforms.
beforeEach(() => {
  vi.stubGlobal('ImageBitmap', class {})
  vi.stubGlobal('OffscreenCanvas', class {})
})
afterEach(() => vi.unstubAllGlobals())

function fixture(count: number, invalid: number[] = []) {
  const positions = Array.from({ length: count }, (_, i) => new Cartesian3(7_000_000, i * 100, 0))
  const run = { id: 'run-test', startMs: 1_000, data: { count, step_s: 30, invalid } } as OrbitRun
  return { positions, run }
}

describe('Earth-relative predicted paths', () => {
  it.each([2881, 20161])(
    'retains every sample of a %i-point propagation with an identity transform',
    (count) => {
      const { run, positions } = fixture(count)
      const trail = createOrbitTrail(run, positions)
      expect(trail.lines.length).toBe(1)
      expect(trail.segments[0]?.positions).toEqual(positions)
      expect(trail.segments[0]?.timesMs.at(-1)).toBe(run.startMs + (count - 1) * 30_000)
      expect(Matrix4.equals(trail.lines.modelMatrix, Matrix4.IDENTITY)).toBe(true)
      expect(trail.lines.get(0).material.type).toBe('Color')
      const original = trail.lines.get(0)
      trail.style(Color.CYAN, 4)
      expect(trail.lines.get(0)).toBe(original)
      expect(original.width).toBe(4)
      expect(original.positions).toEqual(positions)
      trail.lines.destroy()
    },
  )

  it('keeps gaps and associates clicked segments only with their own valid sample times', () => {
    const { run, positions } = fixture(10, [0, 3, 4, 8])
    const trail = createOrbitTrail(run, positions)
    expect(trail.segments.map((s) => s.timesMs)).toEqual([
      [31_000, 61_000],
      [151_000, 181_000, 211_000],
    ])
    expect(trail.lines.get(1).id).toEqual({ kind: 'orbit', runId: run.id, segmentIndex: 1 })
    expect(trail.segments[1]?.positions).toEqual(positions.slice(5, 8))
    trail.lines.destroy()
  })
})

describe('splitByTrust', () => {
  it('cuts where the grade changes and shares the boundary sample', () => {
    const levels = ['ok', 'ok', 'low', 'low', 'poor', 'poor'] as const
    expect(splitByTrust(0, 5, (i) => levels[i]!)).toEqual([
      { first: 0, last: 2, level: 'ok' },
      { first: 2, last: 4, level: 'low' },
      { first: 4, last: 5, level: 'poor' },
    ])
  })

  it('keeps a single-grade range whole and folds a change on the last sample into its piece', () => {
    expect(splitByTrust(3, 7, () => 'ok')).toEqual([{ first: 3, last: 7, level: 'ok' }])
    const levels = ['ok', 'ok', 'low'] as const
    expect(splitByTrust(0, 2, (i) => levels[i]!)).toEqual([{ first: 0, last: 2, level: 'ok' }])
  })
})

describe('element-age styling', () => {
  it('recolours the stretch far from the epoch with the grade colour', () => {
    const day = 86_400_000
    const positions = Array.from({ length: 4 }, (_, i) => new Cartesian3(7_000_000, i * 100, 0))
    const run = {
      id: 'run-old',
      startMs: 13 * day,
      data: {
        count: 4,
        step_s: day / 1000,
        invalid: [],
        element_set: { epoch: new Date(0).toISOString() },
      },
    } as unknown as OrbitRun
    const trail = createOrbitTrail(run, positions)
    expect(trail.segments.map((s) => s.level)).toEqual(['low', 'poor'])
    expect(trail.lines.get(1).material.type).toBe('Color')
    trail.style(Color.CYAN.withAlpha(0.5), 2, { low: '#ffa726', poor: '#ef5350' })
    const low = trail.lines.get(0).material.uniforms.color as Color
    const poor = trail.lines.get(1).material.uniforms.color as Color
    expect(low.toCssHexString()).toBe('#ffa72680')
    expect(poor.toCssHexString()).toBe('#ef535080')
    trail.lines.destroy()
  })
})

describe('splitByEclipse', () => {
  it('cuts pieces at the eclipse edges inside them and marks the dark ones', () => {
    const pieces = [
      { first: 0, last: 10, level: 'ok' as const },
      { first: 10, last: 20, level: 'low' as const },
    ]
    expect(splitByEclipse(pieces, [2.5, 4.25, 8, 12.5])).toEqual([
      { from: 0, to: 2.5, level: 'ok', eclipsed: false },
      { from: 2.5, to: 4.25, level: 'ok', eclipsed: true },
      { from: 4.25, to: 8, level: 'ok', eclipsed: false },
      { from: 8, to: 10, level: 'ok', eclipsed: true },
      { from: 10, to: 12.5, level: 'low', eclipsed: true },
      { from: 12.5, to: 20, level: 'low', eclipsed: false },
    ])
  })

  it('leaves pieces whole without eclipse data or when an eclipse covers them', () => {
    const pieces = [{ first: 3, last: 7, level: 'ok' as const }]
    expect(splitByEclipse(pieces, [])).toEqual([{ from: 3, to: 7, level: 'ok', eclipsed: false }])
    expect(splitByEclipse(pieces, [3, 7])).toEqual([
      { from: 3, to: 7, level: 'ok', eclipsed: true },
    ])
  })
})

describe('eclipse styling', () => {
  function eclipsedRun(eclipse_s: number[] | null) {
    const { run, positions } = fixture(6)
    return { run: { ...run, data: { ...run.data, eclipse_s } } as OrbitRun, positions }
  }

  it('adds a vertex at each eclipse edge and keeps lines and segments aligned', () => {
    // Samples are 30 s apart: the eclipse runs from sample 1.5 to sample 3.
    const { run, positions } = eclipsedRun([45, 90])
    const trail = createOrbitTrail(run, positions)
    expect(trail.segments.map((s) => s.eclipsed)).toEqual([false, true, false])
    expect(trail.segments.map((s) => s.timesMs)).toEqual([
      [1_000, 31_000, 46_000],
      [46_000, 61_000, 91_000],
      [91_000, 121_000, 151_000],
    ])
    expect(trail.segments[0]!.positions.at(-1)).toEqual(new Cartesian3(7_000_000, 150, 0))
    expect(trail.segments[1]!.positions[0]).toEqual(new Cartesian3(7_000_000, 150, 0))
    expect(trail.lines.length).toBe(3)
    trail.segments.forEach((segment, index) => {
      expect(trail.lines.get(index).positions).toEqual(segment.positions)
      expect(trail.lines.get(index).id.segmentIndex).toBe(index)
    })
    trail.lines.destroy()
  })

  it('dims only the eclipsed stretch, and only when asked to', () => {
    const { run, positions } = eclipsedRun([45, 90])
    const trail = createOrbitTrail(run, positions)
    const colorOf = (index: number) =>
      (trail.lines.get(index).material.uniforms.color as Color).toCssHexString()
    const dim = { lineBrightness: 0.5, lineAlpha: 0.5 }
    trail.style(Color.fromCssColorString('#80c0ff'), 2, undefined, dim)
    expect([0, 1, 2].map(colorOf)).toEqual(['#80c0ff', '#40608080', '#80c0ff'])
    trail.style(Color.fromCssColorString('#80c0ff'), 2)
    expect([0, 1, 2].map(colorOf)).toEqual(['#80c0ff', '#80c0ff', '#80c0ff'])
    trail.lines.destroy()
  })

  it('draws one plain line for a run without eclipse data', () => {
    for (const eclipse_s of [null, [45]]) {
      const { run, positions } = eclipsedRun(eclipse_s)
      const trail = createOrbitTrail(run, positions)
      expect(trail.lines.length).toBe(1)
      expect(trail.segments[0]!.eclipsed).toBe(false)
      trail.lines.destroy()
    }
  })
})
