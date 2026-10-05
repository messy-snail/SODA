import { CITY_HEIGHT_M, DEFAULT_HOME, sanitizePoint, type CameraPoint } from '../places/camera'
import { isPinIcon, type PinIcon } from '../places/pinIcons'

/** The places tool's saved state: the home view and the user's pins. */
export const PLACES_STORAGE_KEY = 'soda.places'
/** 2: favourites and landmarks became one list of pins. */
export const PLACES_VERSION = 2

/**
 * A place the user keeps: shown on the globe as `icon` in palette colour `colorIndex`, and
 * flown to from above at `height_m`.
 */
export interface Pin extends CameraPoint {
  id: string
  name: string
  icon: PinIcon
  /** Palette index; new pins take the next value of a monotonic counter. */
  colorIndex: number
  visible: boolean
}

export interface StoredPlaces {
  version: number
  home: CameraPoint
  pins: Pin[]
}

export const MAX_NAME_LENGTH = 60
export const MAX_PINS = 200

export function defaultPlaces(): StoredPlaces {
  return { version: PLACES_VERSION, home: { ...DEFAULT_HOME }, pins: [] }
}

export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().slice(0, MAX_NAME_LENGTH)
  return name || null
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

/** Read one pin, filling what a v1 favourite or landmark did not have. */
function pinOf(value: unknown, fallback: Pick<Pin, 'icon' | 'height_m'>): Pin | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = cleanName(raw.name)
  if (!name || !isId(raw.id)) return null
  if (typeof raw.lat_deg !== 'number' || Math.abs(raw.lat_deg) > 90) return null
  const height_m = typeof raw.height_m === 'number' ? raw.height_m : fallback.height_m
  const point = sanitizePoint({ ...raw, height_m })
  if (!point) return null
  const index = raw.colorIndex
  return {
    id: raw.id,
    name,
    ...point,
    icon: isPinIcon(raw.icon) ? raw.icon : fallback.icon,
    colorIndex: typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : 0,
    visible: raw.visible !== false,
  }
}

const list = (items: unknown): unknown[] => (Array.isArray(items) ? items : [])

/**
 * Repair whatever was stored: bad pins are dropped, a bad home falls back to default.
 * Version 1 kept favourites and landmarks apart; both become pins, favourites as stars.
 */
export function sanitizePlaces(value: unknown): StoredPlaces {
  const fallback = defaultPlaces()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  const candidates: (Pin | null)[] =
    raw.version === PLACES_VERSION
      ? list(raw.pins).map((pin) => pinOf(pin, { icon: 'pin', height_m: CITY_HEIGHT_M }))
      : [
          ...list(raw.bookmarks).map((pin) =>
            pinOf(pin, { icon: 'star', height_m: CITY_HEIGHT_M }),
          ),
          ...list(raw.landmarks).map((pin) => pinOf(pin, { icon: 'pin', height_m: CITY_HEIGHT_M })),
        ]
  const seen = new Set<string>()
  const pins = candidates
    .filter((pin): pin is Pin => !!pin && !seen.has(pin.id) && !!seen.add(pin.id))
    .slice(0, MAX_PINS)
  if (raw.version !== PLACES_VERSION) {
    // v1 landmarks and favourites each counted colours from 0; spread them apart.
    pins.forEach((pin, i) => (pin.colorIndex = i))
  }
  return { version: PLACES_VERSION, home: sanitizePoint(raw.home) ?? fallback.home, pins }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function loadPlaces(storage: StorageLike | null): StoredPlaces {
  if (!storage) return defaultPlaces()
  try {
    return sanitizePlaces(JSON.parse(storage.getItem(PLACES_STORAGE_KEY) ?? 'null'))
  } catch {
    return defaultPlaces()
  }
}

export function savePlaces(storage: StorageLike | null, places: StoredPlaces): void {
  if (!storage) return
  try {
    storage.setItem(PLACES_STORAGE_KEY, JSON.stringify(places))
  } catch {
    /* Session only. */
  }
}
