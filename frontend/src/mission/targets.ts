import type { AccessDiagnosis, AccessTargetRequest } from '../api/types'

/** Imaging targets the backend accepts per request (`orbit/access.py`). */
export const MAX_TARGETS = 20
/** Longest imaging opportunity search, in days (`MAX_ACCESS_WINDOW`, same as propagation). */
export const MAX_ACCESS_DAYS = 30
export const MAX_TARGET_NAME = 40

export interface PointTarget {
  kind: 'point'
  id: string
  name: string
  lat_deg: number
  lon_deg: number
}

/** A longitude/latitude box; `east_deg < west_deg` means it crosses the date line. */
export interface BoxTarget {
  kind: 'box'
  id: string
  name: string
  west_deg: number
  south_deg: number
  east_deg: number
  north_deg: number
}

export type ImagingTarget = PointTarget | BoxTarget

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const lat = (value: unknown): value is number => finite(value) && Math.abs(value) <= 90
const lon = (value: unknown): value is number => finite(value) && Math.abs(value) <= 180

/** Longitude folded into [-180, 180). */
export function wrapLon(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

/**
 * Box spanned by two clicked corners. Of the two ways around the globe the narrower one is
 * meant, so corners either side of the date line give a box across it.
 */
export function boxFromCorners(
  a: { lon_deg: number; lat_deg: number },
  b: { lon_deg: number; lat_deg: number },
): Pick<BoxTarget, 'west_deg' | 'south_deg' | 'east_deg' | 'north_deg'> {
  const eastward = (((b.lon_deg - a.lon_deg) % 360) + 360) % 360
  const [west, east] = eastward <= 180 ? [a.lon_deg, b.lon_deg] : [b.lon_deg, a.lon_deg]
  return {
    west_deg: wrapLon(west),
    east_deg: wrapLon(east),
    south_deg: Math.min(a.lat_deg, b.lat_deg),
    north_deg: Math.max(a.lat_deg, b.lat_deg),
  }
}

/** Box width in degrees of longitude, counting eastward from the west edge. */
export function boxWidthDeg(box: Pick<BoxTarget, 'west_deg' | 'east_deg'>): number {
  return (((box.east_deg - box.west_deg) % 360) + 360) % 360
}

export function targetCenter(target: ImagingTarget): { lat_deg: number; lon_deg: number } {
  if (target.kind === 'point') return { lat_deg: target.lat_deg, lon_deg: target.lon_deg }
  return {
    lat_deg: (target.south_deg + target.north_deg) / 2,
    lon_deg: wrapLon(target.west_deg + boxWidthDeg(target) / 2),
  }
}

export function toRequest(target: ImagingTarget): AccessTargetRequest {
  if (target.kind === 'point') {
    return { id: target.id, lat_deg: target.lat_deg, lon_deg: target.lon_deg }
  }
  const { id, west_deg, south_deg, east_deg, north_deg } = target
  return { id, west_deg, south_deg, east_deg, north_deg }
}

/** One stored target, or null when anything about it is off. */
export function sanitizeTarget(value: unknown): ImagingTarget | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 64) return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_TARGET_NAME) : ''
  if (!name) return null
  if (raw.kind === 'point' && lat(raw.lat_deg) && lon(raw.lon_deg)) {
    return { kind: 'point', id: raw.id, name, lat_deg: raw.lat_deg, lon_deg: raw.lon_deg }
  }
  if (
    raw.kind === 'box' &&
    lon(raw.west_deg) &&
    lon(raw.east_deg) &&
    lat(raw.south_deg) &&
    lat(raw.north_deg) &&
    raw.south_deg < raw.north_deg
  ) {
    return {
      kind: 'box',
      id: raw.id,
      name,
      west_deg: raw.west_deg,
      south_deg: raw.south_deg,
      east_deg: raw.east_deg,
      north_deg: raw.north_deg,
    }
  }
  return null
}

/**
 * Why a target has the imaging windows it has, for the line under its name.
 *
 * - `found`: it has windows; `dark` says how many more passes were lost to the Sun.
 * - `dark`: passes came within reach, all of them without enough Sun.
 * - `outOfReach`: the satellite passed in view, never within roll reach.
 * - `noPass`: it never passed with the target in view.
 */
export type AccessReason =
  | { kind: 'found'; count: number; dark: number }
  | { kind: 'dark'; dark: number; sunDeg: number }
  | { kind: 'outOfReach'; rollDeg: number }
  | { kind: 'noPass' }

/**
 * One diagnosis for a target searched with several satellites: passes add up, and the best
 * any of them did (the highest Sun, the smallest roll) is what a reason quotes.
 */
export function mergeDiagnoses(list: readonly AccessDiagnosis[]): AccessDiagnosis {
  const suns = list.map((item) => item.best_sun_elev_deg).filter((value) => value !== null)
  const rolls = list.map((item) => item.nearest_roll_deg).filter((value) => value !== null)
  return {
    passes: list.reduce((sum, item) => sum + item.passes, 0),
    dark: list.reduce((sum, item) => sum + item.dark, 0),
    best_sun_elev_deg: suns.length ? Math.max(...suns) : null,
    nearest_roll_deg: rolls.length
      ? rolls.reduce((best, value) => (Math.abs(value) < Math.abs(best) ? value : best))
      : null,
  }
}

export function accessReason(windows: number, diagnosis: AccessDiagnosis): AccessReason {
  if (windows > 0) return { kind: 'found', count: windows, dark: diagnosis.dark }
  if (diagnosis.dark > 0 && diagnosis.best_sun_elev_deg !== null) {
    return { kind: 'dark', dark: diagnosis.dark, sunDeg: diagnosis.best_sun_elev_deg }
  }
  if (diagnosis.nearest_roll_deg !== null) {
    return { kind: 'outOfReach', rollDeg: diagnosis.nearest_roll_deg }
  }
  return { kind: 'noPass' }
}
