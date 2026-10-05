import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { parseSatKey, satKey, type SatelliteRef } from '../utils/satelliteRef'

export const PICKS_STORAGE_KEY = 'soda.satellitePicks'
export const MAX_RECENT = 5

export interface SatellitePick {
  key: string
  name: string
}

export interface StoredPicks {
  recent: SatellitePick[]
  favorites: SatellitePick[]
}

/** Shown until anything has been picked: a station, a weather satellite and three imagers. */
export const SUGGESTED_PICKS: readonly SatellitePick[] = [
  { key: 'norad:25544', name: 'ISS' },
  { key: 'norad:43013', name: 'NOAA 20' },
  { key: 'norad:40697', name: 'Sentinel-2A' },
  { key: 'norad:49260', name: 'Landsat 9' },
  { key: 'norad:40536', name: 'KOMPSAT-3A' },
]

function cleanList(value: unknown): SatellitePick[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is SatellitePick =>
      !!item &&
      typeof item.name === 'string' &&
      typeof item.key === 'string' &&
      parseSatKey(item.key) !== null,
  )
}

/** Reads stored picks, dropping anything malformed. */
export function parsePicks(raw: string | null): StoredPicks {
  try {
    const parsed = JSON.parse(raw ?? 'null') as Partial<StoredPicks> | null
    return {
      recent: cleanList(parsed?.recent).slice(0, MAX_RECENT),
      favorites: cleanList(parsed?.favorites),
    }
  } catch {
    return { recent: [], favorites: [] }
  }
}

/** Puts `pick` first, without duplicates, keeping at most MAX_RECENT. */
export function withRecent(list: readonly SatellitePick[], pick: SatellitePick): SatellitePick[] {
  return [pick, ...list.filter((item) => item.key !== pick.key)].slice(0, MAX_RECENT)
}

/** Recently picked and starred satellites, kept per browser. */
export const useSatellitePicksStore = defineStore('satellitePicks', () => {
  let stored: StoredPicks = { recent: [], favorites: [] }
  try {
    stored = parsePicks(localStorage.getItem(PICKS_STORAGE_KEY))
  } catch {
    /* No storage: start empty. */
  }
  const recent = ref<SatellitePick[]>(stored.recent)
  const favorites = ref<SatellitePick[]>(stored.favorites)

  watch(
    [recent, favorites],
    () => {
      try {
        localStorage.setItem(
          PICKS_STORAGE_KEY,
          JSON.stringify({ recent: recent.value, favorites: favorites.value }),
        )
      } catch {
        /* Session only. */
      }
    },
    { deep: true },
  )

  function noteRecent(ref: SatelliteRef, name: string) {
    recent.value = withRecent(recent.value, { key: satKey(ref), name })
  }

  function isFavorite(ref: SatelliteRef): boolean {
    const key = satKey(ref)
    return favorites.value.some((item) => item.key === key)
  }

  function toggleFavorite(ref: SatelliteRef, name: string) {
    const key = satKey(ref)
    favorites.value = isFavorite(ref)
      ? favorites.value.filter((item) => item.key !== key)
      : [...favorites.value, { key, name }]
  }

  /** Forgets a satellite everywhere, e.g. once its saved elements are deleted. */
  function forget(ref: SatelliteRef) {
    const key = satKey(ref)
    recent.value = recent.value.filter((item) => item.key !== key)
    favorites.value = favorites.value.filter((item) => item.key !== key)
  }

  return { recent, favorites, noteRecent, isFavorite, toggleFavorite, forget }
})
