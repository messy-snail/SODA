import { describe, expect, it } from 'vitest'
import {
  bandsGradient,
  farthestDays,
  trustBands,
  trustLevel,
  trustReferenceRun,
  worstLevel,
} from './epochTrust'

const DAY = 86_400_000
const EPOCH = Date.UTC(2026, 8, 15)

describe('trustLevel', () => {
  it('steps at 3, 7 and 14 days on either side of the epoch', () => {
    expect(trustLevel(EPOCH, EPOCH)).toBe('ok')
    expect(trustLevel(EPOCH, EPOCH + 3 * DAY)).toBe('ok')
    expect(trustLevel(EPOCH, EPOCH + 3 * DAY + 1)).toBe('caution')
    expect(trustLevel(EPOCH, EPOCH - 5 * DAY)).toBe('caution')
    expect(trustLevel(EPOCH, EPOCH + 8 * DAY)).toBe('low')
    expect(trustLevel(EPOCH, EPOCH - 15 * DAY)).toBe('poor')
  })

  it('grades a window by its farther end', () => {
    expect(worstLevel(EPOCH, EPOCH - DAY, EPOCH + 9 * DAY)).toBe('low')
    expect(farthestDays(EPOCH, EPOCH - 2 * DAY, EPOCH + DAY)).toBe(2)
  })
})

describe('trustBands', () => {
  it('cuts a window at each grade boundary and merges equal neighbours', () => {
    const bands = trustBands(EPOCH, EPOCH - 4 * DAY, EPOCH + 20 * DAY)
    expect(bands.map((band) => band.level)).toEqual(['caution', 'ok', 'caution', 'low', 'poor'])
    expect(bands[0]!.startMs).toBe(EPOCH - 4 * DAY)
    expect(bands[1]!.startMs).toBe(EPOCH - 3 * DAY)
    expect(bands.at(-1)!.startMs).toBe(EPOCH + 14 * DAY)
    expect(bands.at(-1)!.endMs).toBe(EPOCH + 20 * DAY)
  })

  it('is one band inside a single grade and empty for an empty window', () => {
    expect(trustBands(EPOCH, EPOCH, EPOCH + DAY)).toEqual([
      { startMs: EPOCH, endMs: EPOCH + DAY, level: 'ok' },
    ])
    expect(trustBands(EPOCH, EPOCH, EPOCH)).toEqual([])
  })
})

describe('bandsGradient', () => {
  const colors = { caution: '#ffff00', low: '#ff8800', poor: '#ff0000' }

  it('is none while every band is good', () => {
    const bands = trustBands(EPOCH, EPOCH, EPOCH + DAY)
    expect(bandsGradient(bands, EPOCH, EPOCH + DAY, colors)).toBe('none')
  })

  it('places hard colour stops at each band edge', () => {
    const stop = EPOCH + 6 * DAY
    const css = bandsGradient(trustBands(EPOCH, EPOCH, stop), EPOCH, stop, colors)
    expect(css).toBe(
      'linear-gradient(to right, transparent 0.000%, transparent 50.000%, ' +
        '#ffff002e 50.000%, #ffff002e 100.000%)',
    )
  })
})

describe('trustReferenceRun', () => {
  const runs = [
    { id: 'a', visible: true, epochMs: EPOCH },
    { id: 'b', visible: true, epochMs: EPOCH - 10 * DAY },
    { id: 'c', visible: false, epochMs: EPOCH - 30 * DAY },
  ]

  it('follows the selected run', () => {
    expect(trustReferenceRun(runs, 'a', EPOCH)?.id).toBe('a')
  })

  it('otherwise picks the visible run furthest from its epoch', () => {
    expect(trustReferenceRun(runs, null, EPOCH)?.id).toBe('b')
    expect(trustReferenceRun([], null, EPOCH)).toBeNull()
  })
})
