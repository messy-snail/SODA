export type MarkerShape = 'point' | 'sphere' | 'cube'

export const MARKER_SHAPES: readonly MarkerShape[] = ['point', 'sphere', 'cube']
export const MARKER_SIZE_RANGE = [1, 120] as const
export const MARKER_PIXEL_RANGE = [16, 128] as const

/** How propagated satellites are drawn when no GLB model applies. */
export interface MarkerStyle {
  shape: MarkerShape
  /** Cube edge or sphere diameter. */
  size_m: number
  /** Screen size the shape never shrinks below, so it stays visible from far away. */
  minimum_size_px: number
}

export function defaultMarkerStyle(): MarkerStyle {
  return { shape: 'cube', size_m: 5, minimum_size_px: 48 }
}

function clamp(value: unknown, [min, max]: readonly [number, number], fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Rebuild a style from untrusted storage, dropping anything malformed. */
export function sanitizeMarkerStyle(raw: unknown): MarkerStyle {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const defaults = defaultMarkerStyle()
  return {
    shape: MARKER_SHAPES.includes(source.shape as MarkerShape)
      ? (source.shape as MarkerShape)
      : defaults.shape,
    size_m: clamp(source.size_m, MARKER_SIZE_RANGE, defaults.size_m),
    minimum_size_px: clamp(source.minimum_size_px, MARKER_PIXEL_RANGE, defaults.minimum_size_px),
  }
}
