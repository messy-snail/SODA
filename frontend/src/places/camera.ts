/** Camera targets for the places tool, kept free of Cesium so they can be unit tested. */

export interface CameraPoint {
  lon_deg: number
  lat_deg: number
  height_m: number
}

export type Bbox = [west: number, south: number, east: number, north: number]

/** Height above which the home view shows the whole Earth rather than a region. */
const WHOLE_EARTH_M = 15_000_000
/** Smallest framed extent, so a city-state still shows its surroundings. */
const MIN_SPAN_DEG = 1.5

export const MIN_HEIGHT_M = 200
export const MAX_HEIGHT_M = 100_000_000

export const DEFAULT_HOME: CameraPoint = { lon_deg: 127.8, lat_deg: 36.3, height_m: 20_000_000 }

/**
 * Where the home view puts the camera in each scene mode.
 *
 * A whole-Earth home in 2D centres the map on the home meridian and the equator, so the
 * full map width fits; 2D needs about twice the height for the same extent. A regional
 * home keeps its latitude in both modes.
 */
export function homeDestination(home: CameraPoint, mode: '3d' | '2d'): CameraPoint {
  if (mode === '3d') return home
  const whole = home.height_m >= WHOLE_EARTH_M
  return { lon_deg: home.lon_deg, lat_deg: whole ? 0 : home.lat_deg, height_m: home.height_m * 2 }
}

/** Wrap a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  // Leave in-range values untouched: the modulo below would add rounding noise.
  if (lon >= -180 && lon < 180) return lon
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/**
 * Pad an extent by `fraction` of its span on each side, with a minimum span.
 *
 * An extent that crosses the antimeridian keeps `east < west`; the span is measured across
 * the line, and Cesium's Rectangle understands that ordering.
 */
export function paddedBbox([west, south, east, north]: Bbox, fraction = 0.15): Bbox {
  const lonSpan = east >= west ? east - west : east + 360 - west
  const padLon = Math.max(lonSpan * fraction, (MIN_SPAN_DEG - lonSpan) / 2, 0)
  const latSpan = north - south
  const padLat = Math.max(latSpan * fraction, (MIN_SPAN_DEG - latSpan) / 2, 0)
  if (lonSpan + 2 * padLon >= 360) {
    return [-180, Math.max(south - padLat, -90), 180, Math.min(north + padLat, 90)]
  }
  return [
    wrapLon(west - padLon),
    Math.max(south - padLat, -90),
    wrapLon(east + padLon) === -180 ? 180 : wrapLon(east + padLon),
    Math.min(north + padLat, 90),
  ]
}

/** Clamp a camera point into the ranges the globe accepts, or null if it is not finite. */
export function sanitizePoint(value: unknown): CameraPoint | null {
  if (!value || typeof value !== 'object') return null
  const { lon_deg, lat_deg, height_m } = value as Record<string, unknown>
  if (![lon_deg, lat_deg, height_m].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  return {
    lon_deg: wrapLon(lon_deg as number),
    lat_deg: Math.min(Math.max(lat_deg as number, -90), 90),
    height_m: Math.min(Math.max(height_m as number, MIN_HEIGHT_M), MAX_HEIGHT_M),
  }
}

/** Camera height that frames a city from above. */
export const CITY_HEIGHT_M = 400_000

/**
 * A single camera point that shows an extent, for saving a country as a pin.
 *
 * About 150 km of height per degree of the wider side keeps the whole extent in view with
 * the default field of view.
 */
export function pointForBbox(bbox: Bbox, label?: readonly [number, number]): CameraPoint {
  const [west, south, east, north] = bbox
  const lonSpan = east >= west ? east - west : east + 360 - west
  const span = Math.max(lonSpan * Math.cos((((south + north) / 2) * Math.PI) / 180), north - south)
  return {
    lon_deg: label ? label[0] : wrapLon(west + lonSpan / 2),
    lat_deg: label ? label[1] : (south + north) / 2,
    height_m: Math.min(Math.max(span * 150_000, 300_000), 20_000_000),
  }
}
