import type { Locale } from '../i18n/locale'
import type { City, Country } from './geoData'

export interface LatLon {
  lat_deg: number
  lon_deg: number
}

export type PlaceHit = { kind: 'country'; country: Country } | { kind: 'city'; city: City }

const MAX_HITS = 20

/** A signed number optionally followed by a hemisphere letter. */
const TOKEN = /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/i

function parseToken(token: string): { value: number; hemi: string | null } | null {
  const match = TOKEN.exec(token.trim())
  if (!match) return null
  const hemi = match[2]?.toUpperCase() ?? null
  let value = Number(match[1])
  if (hemi === 'S' || hemi === 'W') {
    if (value < 0) return null
    value = -value
  }
  return { value, hemi }
}

/**
 * Read a coordinate pair typed into the search box.
 *
 * Accepts `37.5, 127`, `37.5 127`, `37.5N 127E`, `127E 37.5N` and `33.9S, 18.4E`. Without
 * hemisphere letters the order is latitude then longitude, the way coordinates are usually
 * written. Returns null for anything that is not a valid pair.
 */
export function parseLatLon(text: string): LatLon | null {
  const parts = text
    .trim()
    .split(/\s*,\s*|\s+(?=[+-]?\d)/)
    .filter(Boolean)
  if (parts.length !== 2) return null
  const a = parseToken(parts[0]!)
  const b = parseToken(parts[1]!)
  if (!a || !b) return null
  const isLon = (hemi: string | null) => hemi === 'E' || hemi === 'W'
  const isLat = (hemi: string | null) => hemi === 'N' || hemi === 'S'
  if ((isLat(a.hemi) && isLat(b.hemi)) || (isLon(a.hemi) && isLon(b.hemi))) return null
  const swap = isLon(a.hemi) || isLat(b.hemi)
  const lat = swap ? b.value : a.value
  const lon = swap ? a.value : b.value
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat_deg: lat, lon_deg: lon }
}

/** `37.5000°N 127.0000°E`: the form parseLatLon reads back. */
export function formatLatLon(lat: number, lon: number, digits = 4): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(digits)}°${ns} ${Math.abs(lon).toFixed(digits)}°${ew}`
}

export function normalize(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, '')
}

/** 0 exact, 1 prefix, 2 contains, or null when neither name matches. */
function score(needle: string, names: readonly string[]): number | null {
  let best: number | null = null
  for (const name of names) {
    const hay = normalize(name)
    const s = hay === needle ? 0 : hay.startsWith(needle) ? 1 : hay.includes(needle) ? 2 : null
    if (s !== null && (best === null || s < best)) best = s
  }
  return best
}

/**
 * Countries and cities whose Korean or English name matches the query.
 *
 * Exact matches come before prefixes, prefixes before substrings; within a tier countries
 * come before cities and cities by population. The locale only breaks ties in favour of
 * the name the reader sees.
 */
export function searchPlaces(
  query: string,
  countries: readonly Country[],
  cities: readonly City[],
  locale: Locale,
): PlaceHit[] {
  const needle = normalize(query)
  if (!needle) return []
  const other: Locale = locale === 'ko' ? 'en' : 'ko'
  const ranked: { hit: PlaceHit; tier: number; order: number }[] = []
  for (const country of countries) {
    const tier = score(needle, [country.name[locale], country.name[other], country.iso2])
    if (tier !== null) ranked.push({ hit: { kind: 'country', country }, tier, order: 0 })
  }
  for (const city of cities) {
    const tier = score(needle, [city.name[locale], city.name[other]])
    if (tier !== null) ranked.push({ hit: { kind: 'city', city }, tier, order: 1 })
  }
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.order !== b.order) return a.order - b.order
    if (a.hit.kind === 'city' && b.hit.kind === 'city') return b.hit.city.pop - a.hit.city.pop
    return 0
  })
  return ranked.slice(0, MAX_HITS).map((entry) => entry.hit)
}
