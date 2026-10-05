import { markRaw } from 'vue'
import type { Label } from '../i18n/label'
import { indexShapes, type CountryShape, type IndexedShape } from './tint'

/**
 * Country and city tables built from Natural Earth (public domain) by
 * `scripts/build_geo_data.py`. They live in `public/geo/` and are fetched on first use,
 * so the globe pays nothing until borders, labels or search are wanted.
 */

export interface Country {
  /** Natural Earth ADM0_A3: unique, and present where ISO codes are not. */
  a3: string
  iso2: string
  name: Label
  /** Natural Earth's label point, `[lon, lat]`. */
  label: [number, number]
  /** Mainland extent `[west, south, east, north]` in degrees, used to frame the camera. */
  bbox: [number, number, number, number]
  /** Natural Earth label rank: 0 is the most prominent. */
  rank: number
}

export interface City {
  name: Label
  iso2: string
  lon: number
  lat: number
  pop: number
  capital: boolean
}

const cache = new Map<string, Promise<unknown>>()

function load<T extends object>(file: string): Promise<T> {
  let pending = cache.get(file)
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}geo/${file}`)
      .then((response) => {
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
        return response.json() as Promise<T>
      })
      .then((data) => markRaw(data))
      // A failed download may succeed later, so forget it instead of caching the error.
      .catch((error: unknown) => {
        cache.delete(file)
        throw error
      })
    cache.set(file, pending)
  }
  return pending as Promise<T>
}

export const loadCountries = () => load<Country[]>('countries.json')
export const loadCities = () => load<City[]>('places.json')

let shapes: Promise<IndexedShape[]> | null = null

/** Country polygons with bounding boxes, for the tint overlay and point-in-country lookups. */
export function loadShapes(): Promise<IndexedShape[]> {
  shapes ??= load<CountryShape[]>('country-shapes.json').then((raw) => markRaw(indexShapes(raw)))
  shapes.catch(() => (shapes = null))
  return shapes
}
