import type { ImagerySensor, ImagerySet, ImagerySourceFormat } from '../api/types'
import type { CameraPoint } from '../places/camera'
import { translate } from '../i18n'

/** Largest upload the server accepts. Mirrors `MAX_IMAGERY_BYTES` in `src/soda/imagery/limits.py`. */
export const MAX_IMAGERY_BYTES = 1024 * 1024 * 1024

/** Catalogue items one import may name. Mirrors `MAX_CATALOG_IMPORT_ITEMS`. */
export const MAX_CATALOG_IMPORT_ITEMS = 10
/** Widest box, in degrees, a catalogue search accepts. Mirrors `MAX_CATALOG_SEARCH_SPAN_DEG`. */
export const MAX_CATALOG_SEARCH_SPAN_DEG = 20

const EXTENSIONS: Record<ImagerySourceFormat, readonly string[]> = {
  mbtiles: ['mbtiles'],
  image: ['png', 'jpg', 'jpeg'],
  geotiff: ['tif', 'tiff'],
}

export const IMAGERY_FORMATS = Object.keys(EXTENSIONS) as ImagerySourceFormat[]

/** `accept` value of the file input for a format. */
export function imageryAccept(format: ImagerySourceFormat): string {
  return EXTENSIONS[format].map((extension) => `.${extension}`).join(',')
}

function extensionOf(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? ''
}

/** The format a file name suggests, so picking a file can switch the form to match. */
export function guessImageryFormat(fileName: string): ImagerySourceFormat | null {
  const extension = extensionOf(fileName)
  return IMAGERY_FORMATS.find((format) => EXTENSIONS[format].includes(extension)) ?? null
}

/** A user-facing reason the file cannot be uploaded as this format, or an empty string. */
export function imageryFileProblem(
  format: ImagerySourceFormat,
  file: { name: string; size: number },
): string {
  if (!EXTENSIONS[format].includes(extensionOf(file.name))) {
    return translate('uploads.imageryType', { extensions: imageryAccept(format) })
  }
  if (file.size > MAX_IMAGERY_BYTES) {
    return translate('uploads.imageryTooLarge', { max: MAX_IMAGERY_BYTES / (1024 * 1024) })
  }
  return ''
}

export interface BatchEntry {
  file: File
  /** Null when the extension is not one SODA takes. */
  format: ImagerySourceFormat | null
  name: string
  /** A user-facing reason the file is left out of the batch, or an empty string. */
  problem: string
}

/**
 * Sort several picked or dropped files into what can be uploaded as it is and what cannot.
 *
 * MBTiles and GeoTIFF carry their own georeferencing, so a name from the file name is all they
 * need. A plain image needs its four corners typed in, which only the single-file form asks for.
 */
export function planBatch(files: readonly File[]): BatchEntry[] {
  return files.map((file) => {
    const format = guessImageryFormat(file.name)
    let problem = ''
    if (!format) problem = translate('uploads.imageryUnknownType')
    else if (format === 'image') problem = translate('uploads.imageryNeedsCorners')
    else problem = imageryFileProblem(format, file)
    return { file, format, name: nameFromFile(file.name), problem }
  })
}

/** A display name from a file name: its stem, cut to what the server accepts. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').slice(0, 60)
}

/**
 * Four image corners as `[lon, lat] x 4`, from eight numbers or a WKT `POLYGON`.
 *
 * A catalogue footprint is usually a closed WKT ring of five points; the repeated last point
 * is dropped. The order is taken as given: top-left, top-right, bottom-right, bottom-left.
 * Returns null when the text is not four points. Whether they form a usable quad is the
 * server's call.
 */
export function parseCorners(text: string): number[] | null {
  const numbers = (text.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number)
  if (numbers.length === 10 && numbers[0] === numbers[8] && numbers[1] === numbers[9]) {
    numbers.length = 8
  }
  if (numbers.length !== 8 || !numbers.every(Number.isFinite)) return null
  // Anything but digits, separators and a WKT wrapper means the text was something else.
  if (/[^\d\s,.()eE+-]/.test(text.replace(/^\s*polygon/i, ''))) return null
  return numbers
}

export interface ImageryPref {
  /** 0 (invisible) to 1 (opaque). */
  opacity: number
}

export type ImageryPrefs = Record<string, ImageryPref>

export const DEFAULT_IMAGERY_PREF: Readonly<ImageryPref> = { opacity: 1 }

/** Stored per-set display choices, with anything malformed dropped. */
export function sanitizeImageryPrefs(raw: unknown): ImageryPrefs {
  const clean: ImageryPrefs = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !value || typeof value !== 'object') continue
    const { opacity } = value as Partial<ImageryPref>
    clean[id] = {
      opacity:
        typeof opacity === 'number' && Number.isFinite(opacity)
          ? Math.min(1, Math.max(0, opacity))
          : 1,
    }
  }
  return clean
}

const EARTH_RADIUS_M = 6_371_000
const DEG = Math.PI / 180
/** Camera height, in multiples of a set's size, at which the set starts to appear. */
export const IMAGERY_FAR_FACTOR = 8
/** Camera height, in multiples of a set's size, below which the set is fully shown. */
export const IMAGERY_NEAR_FACTOR = 5

export interface CameraGroundPoint {
  lon_deg: number
  lat_deg: number
  height_m: number
}

type ImageryBounds = Pick<ImagerySet, 'west_deg' | 'south_deg' | 'east_deg' | 'north_deg'>

/** Width and height of a set's bounding box on the ground, in metres. */
function groundSize(item: ImageryBounds): { width: number; height: number } | null {
  const { west_deg, south_deg, east_deg, north_deg } = item
  if (west_deg === null || south_deg === null || east_deg === null || north_deg === null)
    return null
  const midLat = (south_deg + north_deg) / 2
  return {
    width: (east_deg - west_deg) * DEG * EARTH_RADIUS_M * Math.cos(midLat * DEG),
    height: (north_deg - south_deg) * DEG * EARTH_RADIUS_M,
  }
}

/**
 * Where to put the camera to look at a set: above its middle, at twice its size.
 *
 * That is well inside the height at which `imageryFade` shows the set in full, whatever its
 * size. Fitting the bounding box instead does not work for a small set: the camera's minimum
 * extent leaves it far above the height where a few kilometres of imagery appear.
 */
export function imageryViewPoint(item: ImageryBounds): CameraPoint | null {
  const size = groundSize(item)
  if (!size || !(Math.max(size.width, size.height) > 0)) return null
  return {
    lon_deg: (item.west_deg! + item.east_deg!) / 2,
    lat_deg: (item.south_deg! + item.north_deg!) / 2,
    height_m: 2 * Math.max(size.width, size.height),
  }
}

/**
 * How strongly a set is drawn for a camera, from 0 (not at all) to 1 (fully).
 *
 * Imagery appears by zooming in on it, not by switching it on: a set fades in once the camera
 * is low enough for it to cover a fair part of the screen, and only while the camera is over
 * or beside it. Height is measured against the set's own size, so a city scene needs a closer
 * look than a mosaic of a whole country.
 */
export function imageryFade(item: ImageryBounds, camera: CameraGroundPoint): number {
  const { west_deg, south_deg, east_deg, north_deg } = item
  if (west_deg === null || south_deg === null || east_deg === null || north_deg === null) return 0
  const { lon_deg, lat_deg, height_m } = camera
  if (![lon_deg, lat_deg, height_m].every(Number.isFinite)) return 0
  const midLat = (south_deg + north_deg) / 2
  const { width, height } = groundSize(item)!
  const size = Math.max(width, height)
  if (!(size > 0)) return 0
  // Great-circle distance from the point under the camera to the middle of the set.
  const midLon = (west_deg + east_deg) / 2
  const dLat = (midLat - lat_deg) * DEG
  const dLon = (midLon - lon_deg) * DEG
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat_deg * DEG) * Math.cos(midLat * DEG) * Math.sin(dLon / 2) ** 2
  const distance = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
  // A tilted camera looks about as far ahead as it is high, so the reach grows with height.
  if (distance > Math.hypot(width, height) / 2 + height_m) return 0
  const far = size * IMAGERY_FAR_FACTOR
  const near = size * IMAGERY_NEAR_FACTOR
  return Math.min(1, Math.max(0, (far - height_m) / (far - near)))
}

function tileX(lonDeg: number, zoom: number): number {
  return Math.floor(((lonDeg + 180) / 360) * 2 ** zoom)
}

function tileY(latDeg: number, zoom: number): number {
  const lat = (Math.max(-85.0511, Math.min(85.0511, latDeg)) * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** zoom)
}

/**
 * The `minimumLevel` to give Cesium for a set.
 *
 * Cesium draws a provider's minimum-level tiles however far the camera is, so it refuses a
 * provider with more than four of them. A set SODA cut always fits; an uploaded MBTiles that
 * starts at a deep level over a wide area does not, and falls back to level 0, where the
 * server answers the levels it lacks with transparent tiles.
 */
export function minimumLevelFor(
  item: Pick<ImagerySet, 'west_deg' | 'south_deg' | 'east_deg' | 'north_deg' | 'min_zoom'>,
): number {
  const { west_deg, south_deg, east_deg, north_deg, min_zoom } = item
  if (west_deg === null || south_deg === null || east_deg === null || north_deg === null) return 0
  if (!min_zoom) return 0
  const last = 2 ** min_zoom - 1
  const clamp = (value: number) => Math.min(last, Math.max(0, value))
  const columns = clamp(tileX(east_deg, min_zoom)) - clamp(tileX(west_deg, min_zoom)) + 1
  const rows = clamp(tileY(south_deg, min_zoom)) - clamp(tileY(north_deg, min_zoom)) + 1
  return columns * rows <= 4 ? min_zoom : 0
}

export interface DateGroup<T> {
  /** `YYYY-MM-DD`, or null for items whose date the catalogue does not give. */
  date: string | null
  /** Stable key for the group: the date, or `undated`. */
  key: string
  items: T[]
}

/**
 * Sort catalogue results into acquisition dates, newest first, undated last.
 *
 * The same ground is often imaged on several days, and the date is what a person picks by.
 * The order of items inside a date is kept as the catalogue gave it.
 */
export function groupByDate<T extends { acquired_at: string | null }>(
  items: readonly T[],
): DateGroup<T>[] {
  const groups = new Map<string, DateGroup<T>>()
  for (const item of items) {
    const date = /^\d{4}-\d{2}-\d{2}/.test(item.acquired_at ?? '')
      ? item.acquired_at!.slice(0, 10)
      : null
    const key = date ?? 'undated'
    if (!groups.has(key)) groups.set(key, { date, key, items: [] })
    groups.get(key)!.items.push(item)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.date === null) return b.date === null ? 0 : 1
    if (b.date === null) return -1
    return b.date.localeCompare(a.date)
  })
}

/** A ground resolution as people say it: `0.3 m`, `5 m`, never `0.30 m` or `5.0 m`. */
export function gsdLabel(gsd_m: number): string {
  const rounded = gsd_m < 1 ? Number(gsd_m.toPrecision(2)) : Math.round(gsd_m * 10) / 10
  return `${rounded} m`
}

/** The steps of the resolution filter: a set passes when it is this sharp or sharper. */
export const GSD_STEPS: readonly number[] = [0.5, 1, 5]

/** What the list is narrowed to; null on either side means no narrowing there. */
export interface ImageryFilter {
  sensor: ImagerySensor | null
  maxGsd: number | null
}

export const NO_IMAGERY_FILTER: Readonly<ImageryFilter> = { sensor: null, maxGsd: null }

type Filterable = Pick<ImagerySet, 'status' | 'sensor' | 'gsd_m'>

/**
 * Whether a set stays in the list. One that is still importing, or failed, always does: it
 * needs watching or dismissing whatever the filter says, and has no resolution yet.
 */
export function matchesImageryFilter(item: Filterable, filter: ImageryFilter): boolean {
  if (item.status !== 'ready') return true
  if (filter.sensor !== null && item.sensor !== filter.sensor) return false
  if (filter.maxGsd === null) return true
  // A hair of slack, so 0.5 m stored as 0.5000001 still counts as half a metre.
  return item.gsd_m !== null && item.gsd_m <= filter.maxGsd * 1.001
}

export function filterImagery<T extends Filterable>(
  items: readonly T[],
  filter: ImageryFilter,
): T[] {
  return items.filter((item) => matchesImageryFilter(item, filter))
}

/** How many ready sets each sensor chip stands for. */
export function sensorCounts(items: readonly Filterable[]): Record<ImagerySensor, number> {
  const counts = { optical: 0, sar: 0 }
  for (const item of items) if (item.status === 'ready' && item.sensor) counts[item.sensor] += 1
  return counts
}

/** Whether a licence name forbids commercial use, as the Creative Commons NC ones do. */
export function isNonCommercial(license: string): boolean {
  return /\bNC\b/i.test(license)
}

/** The credit line for a set: its attribution and licence, escaped for Cesium's `Credit`. */
export function imageryCredit(item: Pick<ImagerySet, 'attribution' | 'license'>): string {
  return escapeHtml([item.attribution, item.license].filter(Boolean).join(' · '))
}

/** Escape text for Cesium's `Credit`, which takes HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
