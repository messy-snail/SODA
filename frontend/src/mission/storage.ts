/**
 * Settings of the storage tool: the recorder, the downlink, and what each ground station can
 * receive. The simulation they feed is `recorder.ts`; the contact gating is `linkWindow.ts`.
 */
import type { StatLevel } from './power'
import type { RecorderResult } from './recorder'
import { MAX_TARGETS } from './targets'

export const GBIT = 1e9
export const MBPS = 1e6

/** `s` is the TT&C band, a few Mbps at most; `x` is the payload downlink. */
export type LinkBand = 's' | 'x'
export const LINK_BANDS: readonly LinkBand[] = ['s', 'x']

/** `fifo`: oldest image first. `priority`: images of urgent targets go ahead of the rest. */
export type Playback = 'fifo' | 'priority'
export const PLAYBACKS: readonly Playback[] = ['fifo', 'priority']

/** How one station differs from the default, which is X-band at the X-band rate. */
export interface StationLink {
  stationId: number
  band: LinkBand
  /** Null takes the rate of the band. */
  rateMbps: number | null
}

/** What the storage tool lets the user set, kept with the other mission settings. */
export interface StorageSettings {
  capacityGbit: number
  initialGbit: number
  /** Sensor output while imaging, before compression. */
  imagingMbps: number
  /** Length of one acquisition, centred on each chosen window's best time. */
  shotS: number
  /** Sensor output over stored size. */
  compressionRatio: number
  sMbps: number
  xMbps: number
  /** Elevation an X-band contact needs before it carries data. */
  xMinElevDeg: number
  /** Time a contact spends locking before it carries data. */
  lockS: number
  playback: Playback
  urgentTargetIds: string[]
  /** Stations without a payload downlink; the power tool reads this list too. */
  noDownlinkStationIds: number[]
  stationLinks: StationLink[]
}

export const STORAGE_LIMITS = {
  capacityGbit: [1, 100_000],
  initialGbit: [0, 100_000],
  imagingMbps: [1, 100_000],
  shotS: [1, 3600],
  compressionRatio: [1, 100],
  sMbps: [0.01, 100_000],
  xMbps: [1, 100_000],
  xMinElevDeg: [0, 90],
  lockS: [0, 600],
} as const satisfies Record<string, readonly [number, number]>

export type StorageField = keyof typeof STORAGE_LIMITS

/** A station's own rate, in Mbps. */
export const STATION_RATE_LIMITS = [0.01, 100_000] as const
export const MAX_STATION_LINKS = 64
const MAX_TARGET_ID = 64

export function defaultStorageSettings(): StorageSettings {
  return {
    capacityGbit: 512,
    initialGbit: 0,
    imagingMbps: 1000,
    shotS: 10,
    compressionRatio: 1,
    sMbps: 2,
    xMbps: 300,
    xMinElevDeg: 5,
    lockS: 10,
    playback: 'fifo',
    urgentTargetIds: [],
    noDownlinkStationIds: [],
    stationLinks: [],
  }
}

const inRange = (value: unknown, [lo, hi]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi

function sanitizeLinks(value: unknown): StationLink[] {
  const seen = new Set<number>()
  const links: StationLink[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object') continue
    const { stationId, band, rateMbps } = item as Record<string, unknown>
    if (!Number.isInteger(stationId) || seen.has(stationId as number)) continue
    if (band !== 's' && band !== 'x') continue
    if (rateMbps !== null && !inRange(rateMbps, STATION_RATE_LIMITS)) continue
    seen.add(stationId as number)
    links.push({ stationId: stationId as number, band, rateMbps })
  }
  return links.slice(0, MAX_STATION_LINKS)
}

/** Repair stored settings field by field; anything out of range takes its default. */
export function sanitizeStorageSettings(value: unknown): StorageSettings {
  const fallback = defaultStorageSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  const pick = (key: StorageField) =>
    inRange(raw[key], STORAGE_LIMITS[key]) ? raw[key] : fallback[key]
  const ids = Array.isArray(raw.noDownlinkStationIds) ? raw.noDownlinkStationIds : []
  const urgent = Array.isArray(raw.urgentTargetIds) ? raw.urgentTargetIds : []
  return {
    capacityGbit: pick('capacityGbit'),
    initialGbit: pick('initialGbit'),
    imagingMbps: pick('imagingMbps'),
    shotS: pick('shotS'),
    compressionRatio: pick('compressionRatio'),
    sMbps: pick('sMbps'),
    // Settings saved before the bands were split kept a single downlink rate.
    xMbps: inRange(raw.xMbps, STORAGE_LIMITS.xMbps)
      ? raw.xMbps
      : inRange(raw.downlinkMbps, STORAGE_LIMITS.xMbps)
        ? raw.downlinkMbps
        : fallback.xMbps,
    xMinElevDeg: pick('xMinElevDeg'),
    lockS: pick('lockS'),
    playback: raw.playback === 'priority' ? 'priority' : 'fifo',
    urgentTargetIds: [
      ...new Set(
        urgent.filter(
          (id): id is string => typeof id === 'string' && !!id && id.length <= MAX_TARGET_ID,
        ),
      ),
    ].slice(0, MAX_TARGETS),
    noDownlinkStationIds: ids
      .filter((id): id is number => Number.isInteger(id))
      .slice(0, MAX_STATION_LINKS),
    stationLinks: sanitizeLinks(raw.stationLinks),
  }
}

/** A field's value, or its lower limit while it is half typed or out of range. */
export function storageValue(settings: StorageSettings, field: StorageField): number {
  return inRange(settings[field], STORAGE_LIMITS[field])
    ? settings[field]
    : STORAGE_LIMITS[field][0]
}

/** The settings in the units the simulation works in. */
export interface StorageModel {
  capacityBits: number
  initialBits: number
  /** Bits stored per second of acquisition. */
  imageBps: number
  xMinElevDeg: number
  lockS: number
  priority: boolean
}

export function storageModel(settings: StorageSettings): StorageModel {
  return {
    capacityBits: storageValue(settings, 'capacityGbit') * GBIT,
    initialBits: storageValue(settings, 'initialGbit') * GBIT,
    imageBps:
      (storageValue(settings, 'imagingMbps') * MBPS) / storageValue(settings, 'compressionRatio'),
    xMinElevDeg: storageValue(settings, 'xMinElevDeg'),
    lockS: storageValue(settings, 'lockS'),
    priority: settings.playback === 'priority',
  }
}

/** Whether a station takes payload data at all. */
export function isDownlinkStation(settings: StorageSettings, stationId: number): boolean {
  return !settings.noDownlinkStationIds.includes(stationId)
}

export interface ResolvedLink {
  on: boolean
  band: LinkBand
  /** The station's own rate if it has one, else the rate of its band. */
  rateBps: number
  /** Whether the rate is the station's own. */
  ownRate: boolean
}

export function stationLink(settings: StorageSettings, stationId: number): ResolvedLink {
  const link = settings.stationLinks.find((item) => item.stationId === stationId)
  const band = link?.band ?? 'x'
  const own = link && inRange(link.rateMbps, STATION_RATE_LIMITS) ? link.rateMbps : null
  return {
    on: isDownlinkStation(settings, stationId),
    band,
    rateBps: (own ?? storageValue(settings, band === 's' ? 'sMbps' : 'xMbps')) * MBPS,
    ownRate: own !== null,
  }
}

export type StationMode = 'off' | LinkBand

/** Switch a station off, or on in a band; its own rate is kept either way. */
export function setStationMode(settings: StorageSettings, stationId: number, mode: StationMode) {
  const others = settings.noDownlinkStationIds.filter((id) => id !== stationId)
  if (mode === 'off') {
    settings.noDownlinkStationIds = [...others, stationId].slice(-MAX_STATION_LINKS)
    return
  }
  settings.noDownlinkStationIds = others
  const rateMbps =
    settings.stationLinks.find((item) => item.stationId === stationId)?.rateMbps ?? null
  storeLink(settings, { stationId, band: mode, rateMbps })
}

/** Give a station its own rate; null goes back to the rate of its band. */
export function setStationRate(
  settings: StorageSettings,
  stationId: number,
  rateMbps: number | null,
) {
  const band = settings.stationLinks.find((item) => item.stationId === stationId)?.band ?? 'x'
  storeLink(settings, { stationId, band, rateMbps })
}

/** Only stations that differ from the default are listed, the newest last. */
function storeLink(settings: StorageSettings, link: StationLink) {
  const others = settings.stationLinks.filter((item) => item.stationId !== link.stationId)
  const isDefault = link.band === 'x' && link.rateMbps === null
  settings.stationLinks = (isDefault ? others : [...others, link]).slice(-MAX_STATION_LINKS)
}

/** Fill from which the peak is worth a second look. */
export const PEAK_WARNING_FRACTION = 0.9

/** Which stat tiles deserve a tint: an image that was not stored is an error. */
export function storageStatLevels(
  result: RecorderResult,
  capacityBits: number,
): { peak: StatLevel; lost: StatLevel } {
  return {
    peak: result.peakBits >= capacityBits * PEAK_WARNING_FRACTION ? 'warning' : null,
    lost: result.lostCount > 0 ? 'error' : null,
  }
}

/** Bits as Gbit, with the decimals a value of that size is worth. */
export function formatGbit(bits: number): string {
  const value = bits / GBIT
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)
}
