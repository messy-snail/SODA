import type { Locale } from '../i18n/locale'
import type { City, Country } from './geoData'
import { countryAt, type IndexedShape } from './tint'

/** A city this close to the point names the pin. */
const CITY_RADIUS_KM = 30
const EARTH_RADIUS_KM = 6371

/** Great-circle distance in km. */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export interface NamingData {
  cities: readonly City[]
  countries: readonly Country[]
  shapes: readonly IndexedShape[]
}

/**
 * A name for a pin the user did not name: the nearest city within 30 km, else the country
 * the point lies in, else `fallback` (e.g. "Pin 3") at sea. The result is made unique
 * against `taken` by appending " (2)", " (3)", ...
 */
export function defaultPinName(
  lon: number,
  lat: number,
  data: NamingData | null,
  locale: Locale,
  taken: readonly string[],
  fallback: string,
): string {
  let base = fallback
  if (data) {
    let best: City | null = null
    let bestKm = CITY_RADIUS_KM
    for (const city of data.cities) {
      // Cheap reject before the trigonometry: 30 km is well under half a degree of latitude.
      if (Math.abs(city.lat - lat) > 0.5) continue
      const km = distanceKm(lon, lat, city.lon, city.lat)
      if (km <= bestKm) {
        best = city
        bestKm = km
      }
    }
    if (best) base = best.name[locale]
    else {
      const shape = countryAt(data.shapes, lon, lat)
      const country = shape && data.countries.find((c) => c.a3 === shape.a3)
      if (country) base = country.name[locale]
    }
  }
  return uniqueName(base, taken)
}

export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const name = `${base} (${n})`
    if (!used.has(name)) return name
  }
}
