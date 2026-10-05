/**
 * Settings of the power tool and the shapes it trades with `/power`. The energy balance
 * itself runs on the server, which has the DE421 Sun; this side only prepares the request
 * and reads the answer.
 */
import type { ContactAttitude, PowerRequest, PowerResponse } from '../api/types'
import type { LevelPoint, TimeSpan } from '../utils/levelChart'
import {
  batteryModel,
  batterySettingsValid,
  defaultBatterySettings,
  sanitizeBatterySettings,
  type BatterySettings,
} from './battery'

export const CONTACT_ATTITUDES: readonly ContactAttitude[] = ['sun', 'nadir', 'station']

/** `energy` counts watt-hours with two efficiencies; `circuit` is the equivalent circuit. */
export type BatteryKind = 'energy' | 'circuit'
export const BATTERY_KINDS: readonly BatteryKind[] = ['energy', 'circuit']

/** What the power tool lets the user set, kept with the other mission settings. */
export interface PowerSettings {
  /** Array output facing the Sun at 1 AU, after losses. */
  arrayW: number
  capacityWh: number
  initialSocPct: number
  /** Depth of discharge the battery should stay within. */
  dodLimitPct: number
  chargeEffPct: number
  dischargeEffPct: number
  baseW: number
  /** Added to the base load during an acquisition. */
  imagingW: number
  /** Added during a contact with a downlink station. */
  downlinkW: number
  /** Added during any other contact. */
  contactW: number
  /** Time before and after an activity spent in its attitude. */
  slewS: number
  contactAttitude: ContactAttitude
  batteryKind: BatteryKind
  /** Read when `batteryKind` is `circuit`; `capacityWh` is the energy model's. */
  battery: BatterySettings
}

export type PowerField = Exclude<keyof PowerSettings, 'contactAttitude' | 'batteryKind' | 'battery'>

/** The ranges `PowerModel` accepts in `src/soda/api/schemas.py`. */
export const POWER_LIMITS = {
  arrayW: [1, 100_000],
  capacityWh: [1, 1_000_000],
  initialSocPct: [0, 100],
  dodLimitPct: [1, 100],
  chargeEffPct: [50, 100],
  dischargeEffPct: [50, 100],
  baseW: [0, 100_000],
  imagingW: [0, 100_000],
  downlinkW: [0, 100_000],
  contactW: [0, 100_000],
  slewS: [0, 600],
} as const satisfies Record<PowerField, readonly [number, number]>

export const POWER_FIELDS = Object.keys(POWER_LIMITS) as PowerField[]

export function defaultPowerSettings(): PowerSettings {
  return {
    arrayW: 1300,
    capacityWh: 2000,
    initialSocPct: 100,
    dodLimitPct: 30,
    chargeEffPct: 90,
    dischargeEffPct: 90,
    baseW: 400,
    imagingW: 300,
    downlinkW: 200,
    contactW: 50,
    slewS: 60,
    contactAttitude: 'sun',
    batteryKind: 'energy',
    battery: defaultBatterySettings(),
  }
}

const inRange = (value: unknown, [lo, hi]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi

/** Repair stored settings field by field; anything out of range takes its default. */
export function sanitizePowerSettings(value: unknown): PowerSettings {
  const settings = defaultPowerSettings()
  if (!value || typeof value !== 'object') return settings
  const raw = value as Record<string, unknown>
  for (const field of POWER_FIELDS) {
    const stored = raw[field]
    if (inRange(stored, POWER_LIMITS[field])) settings[field] = stored
  }
  const attitude = CONTACT_ATTITUDES.find((item) => item === raw.contactAttitude)
  if (attitude) settings.contactAttitude = attitude
  if (raw.batteryKind === 'circuit') settings.batteryKind = 'circuit'
  settings.battery = sanitizeBatterySettings(raw.battery)
  return settings
}

/** Whether every number is one the server accepts; a half-typed field is not. */
export function powerSettingsValid(settings: PowerSettings): boolean {
  return (
    POWER_FIELDS.every((field) => inRange(settings[field], POWER_LIMITS[field])) &&
    (settings.batteryKind === 'energy' || batterySettingsValid(settings.battery))
  )
}

export function powerModel(settings: PowerSettings): PowerRequest['power'] {
  return {
    array_w: settings.arrayW,
    capacity_wh: settings.capacityWh,
    initial_soc_pct: settings.initialSocPct,
    charge_efficiency: settings.chargeEffPct / 100,
    discharge_efficiency: settings.dischargeEffPct / 100,
    dod_limit_pct: settings.dodLimitPct,
    base_w: settings.baseW,
    imaging_w: settings.imagingW,
    downlink_w: settings.downlinkW,
    contact_w: settings.contactW,
    contact_attitude: settings.contactAttitude,
    slew_s: settings.slewS,
    ...(settings.batteryKind === 'circuit' ? { battery: batteryModel(settings.battery) } : {}),
  }
}

/** One series of the response as chart vertices on the clock's time axis. */
export function seriesPoints(response: PowerResponse, values: readonly number[]): LevelPoint[] {
  const startMs = Date.parse(response.start)
  return response.time_s.map((seconds, index) => ({
    ms: startMs + seconds * 1000,
    value: values[index] ?? 0,
  }))
}

/** State of charge (0 to 1) as chart vertices. */
export function powerPoints(response: PowerResponse): LevelPoint[] {
  return seriesPoints(response, response.soc)
}

/** A flat `[start0, end0, ...]` list of seconds from `start` as spans on the clock's axis. */
export function spansMs(flat: readonly number[], start: string): TimeSpan[] {
  const startMs = Date.parse(start)
  const spans: TimeSpan[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    spans.push({ startMs: startMs + flat[i]! * 1000, endMs: startMs + flat[i + 1]! * 1000 })
  }
  return spans
}

/** The level at `ms` on a piecewise-linear curve, or null outside it. */
export function levelAt(points: readonly LevelPoint[], ms: number): number | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || ms < first.ms || ms > last.ms) return null
  let low = 0
  let high = points.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (points[middle]!.ms <= ms) low = middle
    else high = middle
  }
  const a = points[low]!
  const b = points[high]!
  return b.ms === a.ms ? b.value : a.value + ((b.value - a.value) * (ms - a.ms)) / (b.ms - a.ms)
}

/** How a stat tile is tinted: a warning, an error, or nothing. */
export type StatLevel = 'warning' | 'error' | null

/** Slack for values the server rounded, in percent of the capacity. */
const LEVEL_EPSILON_PCT = 1e-3

/**
 * Which stat tiles deserve a tint. An empty battery is an error and a charge past the depth
 * of discharge limit is a warning. Ending below the starting charge is not one by itself: a
 * run that stops in an eclipse does that with a balanced budget.
 */
export function powerStatLevels(
  response: PowerResponse,
  dodLimitPct: number,
  nowSoc: number | null,
): { depth: StatLevel; final: StatLevel; now: StatLevel } {
  const beyond = (dodPct: number) => dodPct > dodLimitPct + LEVEL_EPSILON_PCT
  const finalPct = response.final_soc * 100
  const level = (empty: boolean, warn: boolean): StatLevel =>
    empty ? 'error' : warn ? 'warning' : null
  return {
    depth: level(response.unmet_wh > 0, beyond(response.max_dod * 100)),
    final: level(finalPct <= LEVEL_EPSILON_PCT, beyond(100 - finalPct)),
    now: nowSoc === null ? null : level(nowSoc <= 0, beyond((1 - nowSoc) * 100)),
  }
}
