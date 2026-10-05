import type { Category } from '../api/types'
import { persistenceSuspended } from '../utils/resetClientState'

export const ORBIT_FILTER_KEY = 'soda.catalogFilter'
/** Orbit classes to filter by; debris is left out, nobody propagates it on purpose. */
export const ORBIT_CATEGORIES: readonly Category[] = ['LEO', 'MEO', 'GEO', 'HEO']
/** Most picks are imaging and weather satellites in low orbit. */
export const DEFAULT_ORBIT_FILTER: readonly Category[] = ['LEO']

/**
 * Reads a stored filter. Missing or malformed values fall back to the default; an empty list
 * is kept, since it is how "every class" is saved.
 */
export function parseOrbitFilter(raw: string | null): Category[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (!Array.isArray(parsed)) return [...DEFAULT_ORBIT_FILTER]
    return ORBIT_CATEGORIES.filter((item) => parsed.includes(item))
  } catch {
    return [...DEFAULT_ORBIT_FILTER]
  }
}

export function loadOrbitFilter(): Category[] {
  try {
    return parseOrbitFilter(localStorage.getItem(ORBIT_FILTER_KEY))
  } catch {
    return [...DEFAULT_ORBIT_FILTER]
  }
}

export function saveOrbitFilter(value: readonly Category[]) {
  if (persistenceSuspended()) return
  try {
    localStorage.setItem(ORBIT_FILTER_KEY, JSON.stringify(value))
  } catch {
    /* Session only. */
  }
}
