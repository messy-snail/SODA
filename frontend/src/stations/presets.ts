import type { Locale } from '../i18n/locale'
import type { Station, StationInput } from '../api/types'
import { ASIA_STATIONS } from './catalog/asia'
import { ESA_STATIONS } from './catalog/esa'
import { NASA_STATIONS } from './catalog/nasa'
import { OTHER_STATIONS } from './catalog/other'
import { POLAR_STATIONS } from './catalog/polar'
import { NETWORKS, type Label, type NetworkId, type StationPreset } from './types'

export type { Label, NetworkId, StationPreset }
export { NETWORKS }

export const STATION_PRESETS: StationPreset[] = [
  ...NASA_STATIONS,
  ...ESA_STATIONS,
  ...POLAR_STATIONS,
  ...ASIA_STATIONS,
  ...OTHER_STATIONS,
]

const BY_ID = new Map(STATION_PRESETS.map((preset) => [preset.id, preset]))

export function findPreset(id: string | null | undefined): StationPreset | null {
  return (id && BY_ID.get(id)) || null
}

/** Body for POST /stations. The stored name is the one shown when creating it. */
export function presetToInput(preset: StationPreset, locale: Locale): StationInput {
  return {
    name: preset.name[locale],
    lat_deg: preset.lat_deg,
    lon_deg: preset.lon_deg,
    alt_m: preset.alt_m,
    min_elev_deg: preset.min_elev_deg,
    preset_id: preset.id,
    az_mask: [],
  }
}

/** About 10 m; catalogue coordinates carry four decimals at most where it matters. */
const SAME_SITE_DEG = 1e-4

/**
 * The catalogue entry a station row stands for, if any.
 *
 * Rows saved before ``preset_id`` existed carry a catalogue name and coordinate but no
 * link. Both have to match: a row someone renamed is theirs, even at a catalogue site.
 */
export function presetOf(station: Station): StationPreset | null {
  if (station.preset_id !== null) return findPreset(station.preset_id)
  return (
    STATION_PRESETS.find(
      (preset) =>
        (station.name === preset.name.ko || station.name === preset.name.en) &&
        Math.abs(station.lat_deg - preset.lat_deg) <= SAME_SITE_DEG &&
        Math.abs(station.lon_deg - preset.lon_deg) <= SAME_SITE_DEG,
    ) ?? null
  )
}

/**
 * What to call a station on screen.
 *
 * A station created from the catalogue follows the catalogue, so switching language
 * renames it; one typed in by hand keeps the name it was given.
 */
export function stationLabel(station: Station, locale: Locale): string {
  return presetOf(station)?.name[locale] ?? station.name
}

/** Country name in the reader's language, so 25 country names need no translations. */
export function countryName(code: string, locale: Locale): string {
  try {
    // `fallback: 'code'` keeps an unknown code readable instead of "Unknown Region".
    return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code
  } catch {
    return code
  }
}

export interface CountryGroup {
  /** ISO 3166-1 alpha-2 of where the stations stand, not of who runs them. */
  country: string
  name: string
  presets: StationPreset[]
}

/** Presets grouped by the country they stand in, countries in the reader's alphabet order. */
export function presetsByCountry(presets: StationPreset[], locale: Locale): CountryGroup[] {
  const groups = new Map<string, StationPreset[]>()
  for (const preset of presets) {
    const bucket = groups.get(preset.country)
    if (bucket) bucket.push(preset)
    else groups.set(preset.country, [preset])
  }
  return [...groups]
    .map(([country, members]) => ({
      country,
      name: countryName(country, locale),
      presets: members,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
}

/** Case-insensitive match over the two names, the network, and the country code. */
export function searchPresets(query: string, locale: Locale): StationPreset[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return STATION_PRESETS
  return STATION_PRESETS.filter((preset) =>
    [
      preset.name.ko,
      preset.name.en,
      preset.id,
      NETWORKS[preset.network].short,
      countryName(preset.country, locale),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}
