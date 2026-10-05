/**
 * Coverage of an area: how often, and how far apart, each cell of a grid over a box can be
 * imaged. The server lists the imaging events of every cell for one satellite; here they
 * are merged across satellites and turned into the numbers the map paints. Pure, so it is
 * unit tested.
 */
import { boxWidthDeg, wrapLon } from './targets'

/** Keep in step with MAX_COVERAGE_CELLS in src/soda/orbit/coverage.py. */
export const MAX_COVERAGE_CELLS = 2500

/** Grid sizes on offer, as the most cells each may have. */
export const RESOLUTIONS = { coarse: 400, medium: 1024, fine: 2500 } as const
export type Resolution = keyof typeof RESOLUTIONS
export const RESOLUTION_IDS = Object.keys(RESOLUTIONS) as Resolution[]

export const METRICS = ['count', 'maxGap', 'meanGap', 'first'] as const
export type Metric = (typeof METRICS)[number]

export interface CoverageSettings {
  /** The box target covered; null follows the first box in the list. */
  targetId: string | null
  resolution: Resolution
  metric: Metric
}

export function defaultCoverageSettings(): CoverageSettings {
  return { targetId: null, resolution: 'medium', metric: 'count' }
}

export function sanitizeCoverageSettings(value: unknown): CoverageSettings {
  const fallback = defaultCoverageSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  return {
    targetId: typeof raw.targetId === 'string' ? raw.targetId : null,
    resolution: RESOLUTION_IDS.includes(raw.resolution as Resolution)
      ? (raw.resolution as Resolution)
      : fallback.resolution,
    metric: METRICS.includes(raw.metric as Metric) ? (raw.metric as Metric) : fallback.metric,
  }
}

export interface Box {
  west_deg: number
  south_deg: number
  east_deg: number
  north_deg: number
}

/** A box cut into `nx` columns from the west and `ny` rows from the south. */
export interface Grid extends Box {
  nx: number
  ny: number
}

const RAD = Math.PI / 180

/**
 * Columns and rows that make the cells about square on the ground, within `cells` in all.
 * A degree of longitude shrinks with the cosine of the latitude.
 */
export function gridShape(box: Box, cells: number): { nx: number; ny: number } {
  const height = box.north_deg - box.south_deg
  const scale = Math.max(Math.cos(((box.south_deg + box.north_deg) / 2) * RAD), 0.05)
  const aspect = (boxWidthDeg(box) * scale) / Math.max(height, 1e-9)
  const nx = Math.min(cells, Math.max(1, Math.round(Math.sqrt(cells * aspect))))
  return { nx, ny: Math.max(1, Math.floor(cells / nx)) }
}

/** Centre of cell `index` (`row * nx + column`). */
export function cellCentre(grid: Grid, index: number): { lat_deg: number; lon_deg: number } {
  const column = index % grid.nx
  const row = Math.floor(index / grid.nx)
  const lon = grid.west_deg + ((column + 0.5) * boxWidthDeg(grid)) / grid.nx
  return {
    lat_deg: grid.south_deg + ((row + 0.5) * (grid.north_deg - grid.south_deg)) / grid.ny,
    lon_deg: wrapLon(lon),
  }
}

/** The cell a point falls in, or null outside the box. */
export function cellAt(grid: Grid, lon_deg: number, lat_deg: number): number | null {
  const width = boxWidthDeg(grid)
  const along = (((lon_deg - grid.west_deg) % 360) + 360) % 360
  if (along > width || lat_deg < grid.south_deg || lat_deg > grid.north_deg) return null
  const column = Math.min(grid.nx - 1, Math.floor((along / width) * grid.nx))
  const up = (lat_deg - grid.south_deg) / (grid.north_deg - grid.south_deg)
  return Math.min(grid.ny - 1, Math.floor(up * grid.ny)) * grid.nx + column
}

/** One satellite's events as the server sent them. */
export interface SatelliteEvents {
  /** `satKey` of the satellite. */
  key: string
  startMs: number
  endMs: number
  /** Events per cell. */
  counts: readonly number[]
  /** Seconds from `startMs`, cell after cell. */
  offsetS: readonly number[]
}

export interface TimeWindow {
  startMs: number
  endMs: number
}

/**
 * The span every satellite was searched over, or null when they share none. Gaps are only
 * meaningful where all of them were looked at.
 */
export function commonWindow(sets: readonly TimeWindow[]): TimeWindow | null {
  if (!sets.length) return null
  const startMs = Math.max(...sets.map((set) => set.startMs))
  const endMs = Math.min(...sets.map((set) => set.endMs))
  return endMs > startMs ? { startMs, endMs } : null
}

/** Event times of each cell in epoch ms, every satellite together, inside the window. */
export function mergeEvents(
  sets: readonly SatelliteEvents[],
  cells: number,
  window: TimeWindow,
): number[][] {
  const merged: number[][] = Array.from({ length: cells }, () => [])
  for (const set of sets) {
    let at = 0
    for (let cell = 0; cell < cells; cell++) {
      const count = set.counts[cell] ?? 0
      for (let i = 0; i < count; i++) {
        const ms = set.startMs + set.offsetS[at + i]! * 1000
        if (ms >= window.startMs && ms <= window.endMs) merged[cell]!.push(ms)
      }
      at += count
    }
  }
  if (sets.length > 1) merged.forEach((times) => times.sort((a, b) => a - b))
  return merged
}

/** One value per cell; NaN where the cell has nothing to say. */
export type CellValues = Record<Metric, Float64Array>

/**
 * The four numbers of every cell.
 *
 * - `count`: events in the window. Two satellites in one pass count twice.
 * - `maxGap`: longest wait in seconds, the stretches before the first event and after the
 *   last one included; the whole window for a cell never imaged.
 * - `meanGap`: mean time between consecutive events; NaN with fewer than two. The ends are
 *   left out, since with them it would only restate the count.
 * - `first`: seconds from the window's start to the first event; NaN with none.
 */
export function cellMetrics(
  events: readonly (readonly number[])[],
  window: TimeWindow,
): CellValues {
  const size = events.length
  const values: CellValues = {
    count: new Float64Array(size),
    maxGap: new Float64Array(size),
    meanGap: new Float64Array(size).fill(Number.NaN),
    first: new Float64Array(size).fill(Number.NaN),
  }
  events.forEach((times, cell) => {
    const n = times.length
    values.count[cell] = n
    if (!n) {
      values.maxGap[cell] = (window.endMs - window.startMs) / 1000
      return
    }
    let widest = Math.max(times[0]! - window.startMs, window.endMs - times[n - 1]!)
    for (let i = 1; i < n; i++) widest = Math.max(widest, times[i]! - times[i - 1]!)
    values.maxGap[cell] = widest / 1000
    values.first[cell] = (times[0]! - window.startMs) / 1000
    if (n > 1) values.meanGap[cell] = (times[n - 1]! - times[0]!) / (n - 1) / 1000
  })
  return values
}

/** Relative ground area of each cell: the cosine of its row's latitude. */
export function cellWeights(grid: Grid): Float64Array {
  return Float64Array.from({ length: grid.nx * grid.ny }, (_, index) =>
    Math.cos(cellCentre(grid, index).lat_deg * RAD),
  )
}

function weightedMean(values: Float64Array, weights: Float64Array): number | null {
  let sum = 0
  let total = 0
  values.forEach((value, i) => {
    if (Number.isNaN(value)) return
    sum += value * weights[i]!
    total += weights[i]!
  })
  return total > 0 ? sum / total : null
}

function weightedMedian(values: Float64Array, weights: Float64Array): number | null {
  const kept = Array.from(values, (value, i) => ({ value, weight: weights[i]! }))
    .filter((item) => !Number.isNaN(item.value))
    .sort((a, b) => a.value - b.value)
  const half = kept.reduce((sum, item) => sum + item.weight, 0) / 2
  let running = 0
  for (const item of kept) {
    running += item.weight
    if (running >= half) return item.value
  }
  return null
}

export interface CoverageSummary {
  /** Share of the area imaged at least once, 0 to 1. */
  covered: number
  /** Cells never imaged. */
  empty: number
  /** Longest wait anywhere in the area, in seconds. */
  worstGapS: number
  /** Area mean of the cells' mean gaps; null when no cell has two events. */
  meanGapS: number | null
  /** Area median of the time to the first event; null when nothing is imaged. */
  medianFirstS: number | null
}

/** Area-weighted numbers for the whole box. */
export function summarize(values: CellValues, grid: Grid): CoverageSummary {
  const weights = cellWeights(grid)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let covered = 0
  let empty = 0
  values.count.forEach((count, i) => {
    if (count > 0) covered += weights[i]!
    else empty += 1
  })
  return {
    covered: total > 0 ? covered / total : 0,
    empty,
    worstGapS: values.maxGap.reduce((worst, value) => Math.max(worst, value), 0),
    meanGapS: weightedMean(values.meanGap, weights),
    medianFirstS: weightedMedian(values.first, weights),
  }
}

/** Lowest and highest value among the imaged cells; null when none has one. */
export function valueRange(
  values: Float64Array,
  counts: Float64Array,
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  values.forEach((value, i) => {
    if (Number.isNaN(value) || counts[i] === 0) return
    min = Math.min(min, value)
    max = Math.max(max, value)
  })
  return min <= max ? { min, max } : null
}

/** `#rrggbb` to its three channels. */
function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** Colour at `fraction` (0 to 1) along a ramp of `#rrggbb` stops, as `[r, g, b]`. */
export function rampColor(fraction: number, ramp: readonly string[]): [number, number, number] {
  const at = Math.min(1, Math.max(0, fraction)) * (ramp.length - 1)
  const lower = Math.min(ramp.length - 2, Math.floor(at))
  const from = channels(ramp[lower]!)
  const to = channels(ramp[lower + 1] ?? ramp[lower]!)
  const mix = at - lower
  return [0, 1, 2].map((i) => Math.round(from[i]! + (to[i]! - from[i]!) * mix)) as [
    number,
    number,
    number,
  ]
}

/** One row per cell: its centre and its four values, blank where there is none. */
export function toCsv(grid: Grid, values: CellValues): string {
  const cell = (value: number, digits: number) => (Number.isNaN(value) ? '' : value.toFixed(digits))
  const rows = Array.from(values.count, (count, index) => {
    const centre = cellCentre(grid, index)
    return [
      index,
      centre.lat_deg.toFixed(4),
      centre.lon_deg.toFixed(4),
      count,
      cell(values.maxGap[index]!, 0),
      cell(values.meanGap[index]!, 0),
      cell(values.first[index]!, 0),
    ].join(',')
  })
  return `${['cell', 'lat_deg', 'lon_deg', 'count', 'max_gap_s', 'mean_gap_s', 'first_s'].join(',')}\n${rows.join('\n')}\n`
}
