import type { Category } from '../api/types'

export const CATEGORIES: readonly Category[] = ['LEO', 'MEO', 'GEO', 'HEO', 'DEBRIS']

export const POINT_SIZE_RANGE = [1, 8] as const
export const OPACITY_RANGE = [0.1, 1] as const

/** User styling of the all-satellites point layer. Colors default to the active theme preset. */
export interface CloudStyle {
  /** Point diameter in pixels before distance scaling. */
  pointSize: number
  opacity: number
  /** `#rrggbb` overrides; categories without one use the preset color. */
  colors: Partial<Record<Category, string>>
  hidden: Category[]
}

export function defaultCloudStyle(): CloudStyle {
  return { pointSize: 3, opacity: 0.9, colors: {}, hidden: [] }
}

export function isCategory(value: unknown): value is Category {
  return (CATEGORIES as readonly unknown[]).includes(value)
}

/** Normalize a picker value (`#RRGGBB` or opaque `#RRGGBBAA`) to lowercase `#rrggbb`. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^#([0-9a-f]{6})(ff)?$/i.exec(value.trim())
  return match ? `#${match[1]!.toLowerCase()}` : null
}

function clamp(value: unknown, [min, max]: readonly [number, number], fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Rebuild a style from untrusted storage, dropping anything malformed. */
export function sanitizeCloudStyle(raw: unknown): CloudStyle {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const defaults = defaultCloudStyle()
  const colors: Partial<Record<Category, string>> = {}
  if (typeof source.colors === 'object' && source.colors !== null) {
    for (const [key, value] of Object.entries(source.colors)) {
      const hex = normalizeHex(value)
      if (isCategory(key) && hex) colors[key] = hex
    }
  }
  const hidden = Array.isArray(source.hidden) ? [...new Set(source.hidden.filter(isCategory))] : []
  return {
    pointSize: clamp(source.pointSize, POINT_SIZE_RANGE, defaults.pointSize),
    opacity: clamp(source.opacity, OPACITY_RANGE, defaults.opacity),
    colors,
    hidden,
  }
}

/** Preset category colors with the user's overrides applied. */
export function resolveCategoryColors(
  base: Readonly<Record<Category, string>>,
  overrides: Partial<Record<Category, string>>,
): Record<Category, string> {
  const resolved = { ...base }
  for (const category of CATEGORIES) {
    const override = overrides[category]
    if (override) resolved[category] = override
  }
  return resolved
}
