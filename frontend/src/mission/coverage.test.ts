import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cellAt,
  cellCentre,
  cellMetrics,
  commonWindow,
  defaultCoverageSettings,
  gridShape,
  MAX_COVERAGE_CELLS,
  mergeEvents,
  rampColor,
  RESOLUTIONS,
  sanitizeCoverageSettings,
  summarize,
  toCsv,
  valueRange,
  type Grid,
} from './coverage'

const HOUR = 3_600_000
const KOREA = { west_deg: 124, south_deg: 33, east_deg: 131, north_deg: 39 }
const PACIFIC = { west_deg: 175, south_deg: -20, east_deg: -175, north_deg: -10 }

describe('gridShape', () => {
  it('stays within the cell budget', () => {
    for (const cells of Object.values(RESOLUTIONS)) {
      for (const box of [KOREA, PACIFIC, { ...KOREA, east_deg: 124.2 }]) {
        const { nx, ny } = gridShape(box, cells)
        expect(nx * ny).toBeLessThanOrEqual(cells)
        expect(Math.min(nx, ny)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('makes cells about square on the ground', () => {
    // 7 x 6 degrees at 36 N is about 5.7 x 6 degrees of ground.
    const { nx, ny } = gridShape(KOREA, 1024)
    expect(nx / ny).toBeCloseTo((7 * Math.cos((36 * Math.PI) / 180)) / 6, 1)
    const equator = gridShape({ west_deg: 0, south_deg: -5, east_deg: 20, north_deg: 5 }, 400)
    expect(equator.nx / equator.ny).toBeCloseTo(2, 0)
  })

  it('measures a box across the date line the short way round', () => {
    expect(gridShape(PACIFIC, 400).nx).toBe(
      gridShape({ ...PACIFIC, west_deg: -5, east_deg: 5 }, 400).nx,
    )
  })
})

describe('cells', () => {
  const grid: Grid = { ...KOREA, nx: 7, ny: 6 }

  it('number columns from the west and rows from the south', () => {
    expect(cellCentre(grid, 0)).toEqual({ lat_deg: 33.5, lon_deg: 124.5 })
    expect(cellCentre(grid, 8)).toEqual({ lat_deg: 34.5, lon_deg: 125.5 })
    expect(cellCentre(grid, 41)).toEqual({ lat_deg: 38.5, lon_deg: 130.5 })
  })

  it('find the cell under a point, and nothing outside the box', () => {
    for (const index of [0, 8, 20, 41]) {
      const centre = cellCentre(grid, index)
      expect(cellAt(grid, centre.lon_deg, centre.lat_deg)).toBe(index)
    }
    expect(cellAt(grid, 131, 39)).toBe(41)
    expect(cellAt(grid, 123.9, 36)).toBeNull()
    expect(cellAt(grid, 127, 39.1)).toBeNull()
  })

  it('wrap across the date line', () => {
    const pacific: Grid = { ...PACIFIC, nx: 2, ny: 1 }
    expect(cellCentre(pacific, 0).lon_deg).toBe(177.5)
    expect(cellCentre(pacific, 1).lon_deg).toBe(-177.5)
    expect(cellAt(pacific, 179, -15)).toBe(0)
    expect(cellAt(pacific, -179, -15)).toBe(1)
    expect(cellAt(pacific, 170, -15)).toBeNull()
  })
})

describe('events and metrics', () => {
  const window = { startMs: 0, endMs: 10 * HOUR }
  const a = {
    key: 'a',
    startMs: 0,
    endMs: 10 * HOUR,
    counts: [2, 0, 1],
    offsetS: [3600, 14400, 7200],
  }
  const b = { key: 'b', startMs: HOUR, endMs: 12 * HOUR, counts: [1, 0, 0], offsetS: [3600] }

  it('share the span every satellite was searched over', () => {
    expect(commonWindow([a, b])).toEqual({ startMs: HOUR, endMs: 10 * HOUR })
    expect(commonWindow([a, { startMs: 11 * HOUR, endMs: 12 * HOUR }])).toBeNull()
    expect(commonWindow([])).toBeNull()
  })

  it('merge satellites in time order and drop events outside the window', () => {
    expect(mergeEvents([a, b], 3, window)).toEqual([[HOUR, 2 * HOUR, 4 * HOUR], [], [2 * HOUR]])
    expect(mergeEvents([a, b], 3, { startMs: 1.5 * HOUR, endMs: 3 * HOUR })).toEqual([
      [2 * HOUR],
      [],
      [2 * HOUR],
    ])
  })

  it('count, and measure the waits', () => {
    const values = cellMetrics(mergeEvents([a, b], 3, window), window)
    expect(Array.from(values.count)).toEqual([3, 0, 1])
    // Cell 0: 1 h before the first, gaps of 1 h and 2 h, then 6 h to the end.
    expect(values.maxGap[0]).toBe(6 * 3600)
    expect(values.meanGap[0]).toBe(1.5 * 3600)
    expect(values.first[0]).toBe(3600)
    // A cell never imaged waits the whole window and has nothing else to say.
    expect(values.maxGap[1]).toBe(10 * 3600)
    expect(values.meanGap[1]).toBeNaN()
    expect(values.first[1]).toBeNaN()
    // One event: both ends count toward the wait, and there is no gap to average.
    expect(values.maxGap[2]).toBe(8 * 3600)
    expect(values.meanGap[2]).toBeNaN()
    expect(values.first[2]).toBe(2 * 3600)
  })

  it('summarize by ground area', () => {
    const grid: Grid = { west_deg: 0, south_deg: 0, east_deg: 3, north_deg: 60, nx: 3, ny: 1 }
    const values = cellMetrics(mergeEvents([a, b], 3, window), window)
    const summary = summarize(values, grid)
    expect(summary.covered).toBeCloseTo(2 / 3, 9)
    expect(summary.empty).toBe(1)
    expect(summary.worstGapS).toBe(10 * 3600)
    expect(summary.meanGapS).toBe(1.5 * 3600)
    expect(summary.medianFirstS).toBe(3600)
  })

  it('weights rows near the pole less', () => {
    const grid: Grid = { west_deg: 0, south_deg: 0, east_deg: 1, north_deg: 80, nx: 1, ny: 2 }
    const values = cellMetrics([[HOUR], []], window)
    // The imaged row is centred on 20 N, the empty one on 60 N.
    const south = Math.cos((20 * Math.PI) / 180)
    expect(summarize(values, grid).covered).toBeCloseTo(south / (south + 0.5), 9)
  })

  it('ranges over the imaged cells only', () => {
    const values = cellMetrics(mergeEvents([a, b], 3, window), window)
    expect(valueRange(values.maxGap, values.count)).toEqual({ min: 6 * 3600, max: 8 * 3600 })
    expect(valueRange(values.meanGap, values.count)).toEqual({ min: 5400, max: 5400 })
    const none = cellMetrics([[], []], window)
    expect(valueRange(none.count, none.count)).toBeNull()
  })

  it('writes one row per cell with blanks where there is no value', () => {
    const grid: Grid = { west_deg: 0, south_deg: 0, east_deg: 3, north_deg: 1, nx: 3, ny: 1 }
    const lines = toCsv(grid, cellMetrics(mergeEvents([a, b], 3, window), window)).split('\n')
    expect(lines[0]).toBe('cell,lat_deg,lon_deg,count,max_gap_s,mean_gap_s,first_s')
    expect(lines[1]).toBe('0,0.5000,0.5000,3,21600,5400,3600')
    expect(lines[2]).toBe('1,0.5000,1.5000,0,36000,,')
    expect(lines).toHaveLength(5)
  })
})

describe('rampColor', () => {
  const ramp = ['#000000', '#804020', '#ffffff']

  it('interpolates between the stops and clamps outside them', () => {
    expect(rampColor(0, ramp)).toEqual([0, 0, 0])
    expect(rampColor(0.5, ramp)).toEqual([128, 64, 32])
    expect(rampColor(0.25, ramp)).toEqual([64, 32, 16])
    expect(rampColor(1, ramp)).toEqual([255, 255, 255])
    expect(rampColor(7, ramp)).toEqual([255, 255, 255])
    expect(rampColor(-1, ramp)).toEqual([0, 0, 0])
  })
})

describe('sanitizeCoverageSettings', () => {
  it('keeps what is valid and repairs the rest', () => {
    expect(sanitizeCoverageSettings(null)).toEqual(defaultCoverageSettings())
    expect(
      sanitizeCoverageSettings({
        targetId: 'a',
        resolution: 'fine',
        metric: 'first',
      }),
    ).toEqual({ targetId: 'a', resolution: 'fine', metric: 'first' })
    expect(sanitizeCoverageSettings({ targetId: 3, resolution: 'huge', metric: 'best' })).toEqual(
      defaultCoverageSettings(),
    )
  })
})

describe('limits mirrored from the backend', () => {
  // Vite refuses to import a file outside its root, so the Python module is read as text.
  const source = readFileSync(resolve(process.cwd(), '../src/soda/orbit/coverage.py'), 'utf8')

  it('match coverage.py', () => {
    const match = source.match(/^MAX_COVERAGE_CELLS = (\d+)$/m)
    expect(match, 'coverage.py no longer declares MAX_COVERAGE_CELLS').not.toBeNull()
    expect(MAX_COVERAGE_CELLS).toBe(Number(match![1]))
    expect(Math.max(...Object.values(RESOLUTIONS))).toBeLessThanOrEqual(MAX_COVERAGE_CELLS)
  })
})
