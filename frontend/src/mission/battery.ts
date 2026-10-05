/**
 * Settings of the battery's equivalent circuit: a pack of cells in series whose
 * open-circuit voltage follows the state of charge along a curve. The model itself is
 * `src/soda/orbit/battery.py`; this side keeps the settings and the curve the user types.
 */
import type { PowerRequest } from '../api/types'

export interface OcvPoint {
  socPct: number
  cellV: number
}

export interface BatterySettings {
  cellsSeries: number
  capacityAh: number
  /** Internal resistance of the whole pack. */
  resistanceMohm: number
  maxChargeA: number
  /** Cell voltage charging stops rising at. */
  cellMaxV: number
  /** Cell voltage below which the pack stops discharging. */
  cellMinV: number
  ocv: OcvPoint[]
}

export type BatteryField = Exclude<keyof BatterySettings, 'ocv'>

/** The ranges `BatteryModel` accepts in `src/soda/api/schemas.py`. */
export const BATTERY_LIMITS = {
  cellsSeries: [1, 200],
  capacityAh: [0.1, 100_000],
  resistanceMohm: [0, 10_000],
  maxChargeA: [0.1, 10_000],
  cellMaxV: [0.1, 10],
  cellMinV: [0.1, 10],
} as const satisfies Record<BatteryField, readonly [number, number]>

export const BATTERY_FIELDS = Object.keys(BATTERY_LIMITS) as BatteryField[]
export const MAX_OCV_POINTS = 32
const MAX_CELL_V = 10

/**
 * The shape of a lithium-ion cell's open-circuit voltage, the same starting point the
 * server has. It is an illustration, not a datasheet.
 */
export const DEFAULT_OCV: readonly OcvPoint[] = [
  [0, 3.0],
  [5, 3.3],
  [10, 3.45],
  [20, 3.55],
  [30, 3.62],
  [40, 3.68],
  [50, 3.74],
  [60, 3.82],
  [70, 3.91],
  [80, 4.0],
  [90, 4.09],
  [100, 4.2],
].map(([socPct, cellV]) => ({ socPct: socPct!, cellV: cellV! }))

export function defaultBatterySettings(): BatterySettings {
  return {
    cellsSeries: 8,
    capacityAh: 70,
    resistanceMohm: 40,
    maxChargeA: 35,
    cellMaxV: 4.2,
    cellMinV: 3.0,
    ocv: DEFAULT_OCV.map((point) => ({ ...point })),
  }
}

/** Why a curve cannot be used, or null when it can. */
export type OcvProblem = 'count' | 'range' | 'ends' | 'order' | 'falling'

export function ocvProblem(points: readonly OcvPoint[]): OcvProblem | null {
  if (points.length < 2 || points.length > MAX_OCV_POINTS) return 'count'
  const finite = points.every(
    (p) => Number.isFinite(p.socPct) && Number.isFinite(p.cellV) && p.cellV > 0,
  )
  if (!finite || points.some((p) => p.socPct < 0 || p.socPct > 100 || p.cellV > MAX_CELL_V)) {
    return 'range'
  }
  if (points[0]!.socPct !== 0 || points[points.length - 1]!.socPct !== 100) return 'ends'
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.socPct <= points[i - 1]!.socPct) return 'order'
    if (points[i]!.cellV < points[i - 1]!.cellV) return 'falling'
  }
  return null
}

/** One point per line, `SOC %, cell V`, the way the curve is typed. */
export function formatOcv(points: readonly OcvPoint[]): string {
  return points.map((point) => `${point.socPct}, ${point.cellV}`).join('\n')
}

/**
 * Read a typed curve. Blank lines are skipped and a comma, a tab, a semicolon or spaces
 * may separate the two numbers, so a column pasted from a spreadsheet works.
 */
export function parseOcv(
  text: string,
): { points: OcvPoint[]; problem: null } | { points: null; problem: OcvProblem | 'format' } {
  const points: OcvPoint[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const parts = line.trim().split(/[\s,;]+/)
    const [socPct, cellV] = parts.map(Number)
    if (parts.length !== 2 || !Number.isFinite(socPct) || !Number.isFinite(cellV)) {
      return { points: null, problem: 'format' }
    }
    points.push({ socPct: socPct!, cellV: cellV! })
  }
  const problem = ocvProblem(points)
  return problem ? { points: null, problem } : { points, problem: null }
}

const inRange = (value: unknown, [lo, hi]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi

/** Repair stored settings field by field; a curve that cannot be used takes the default. */
export function sanitizeBatterySettings(value: unknown): BatterySettings {
  const settings = defaultBatterySettings()
  if (!value || typeof value !== 'object') return settings
  const raw = value as Record<string, unknown>
  for (const field of BATTERY_FIELDS) {
    const stored = raw[field]
    if (inRange(stored, BATTERY_LIMITS[field])) settings[field] = stored
  }
  const curve = (Array.isArray(raw.ocv) ? raw.ocv : []).map((point: unknown) => {
    const item = (point ?? {}) as Record<string, unknown>
    return { socPct: Number(item.socPct), cellV: Number(item.cellV) }
  })
  if (!ocvProblem(curve)) settings.ocv = curve
  return settings
}

/** Whether the server would accept these; a half-typed field is not. */
export function batterySettingsValid(settings: BatterySettings): boolean {
  return (
    BATTERY_FIELDS.every((field) => inRange(settings[field], BATTERY_LIMITS[field])) &&
    settings.cellMinV < settings.cellMaxV &&
    !ocvProblem(settings.ocv)
  )
}

export function batteryModel(
  settings: BatterySettings,
): NonNullable<PowerRequest['power']['battery']> {
  return {
    cells_series: settings.cellsSeries,
    capacity_ah: settings.capacityAh,
    resistance_ohm: settings.resistanceMohm / 1000,
    max_charge_a: settings.maxChargeA,
    cell_max_v: settings.cellMaxV,
    cell_min_v: settings.cellMinV,
    ocv: settings.ocv.map((point) => ({ soc_pct: point.socPct, cell_v: point.cellV })),
  }
}
