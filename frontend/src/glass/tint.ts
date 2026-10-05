/**
 * Adaptive tint for liquid-glass panels. Pure, so vitest can reach it.
 *
 * A glass pane shows what is behind it, so its legibility depends on that backdrop. Rather
 * than one fixed opacity (grey mud over the dark sky, or unreadable over a bright Earth),
 * each pane gets the least tint that still keeps its text at WCAG-AA-like contrast against
 * the backdrop it currently sits on.
 */

/** Frosted light glass scatters light: the backdrop is lifted before the tint goes on. */
export const LIGHT_LIFT = 0.28
/** Dark glass absorbs: the backdrop is dimmed before the tint goes on. */
export const DARK_DIM = 0.7
/** Tint bounds, so a pane never vanishes nor turns into a flat slab. */
export const MIN_ALPHA = 0.16
export const MAX_ALPHA = 0.92

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an 8-bit sRGB colour. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** Relative luminance of `#rrggbb`. */
export function hexLuminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return relativeLuminance((value >> 16) & 255, (value >> 8) & 255, value & 255)
}

/** Backdrop luminance after the glass's own lift (light) or dimming (dark). */
export function toneBackdrop(luminance: number, dark: boolean): number {
  return dark ? luminance * DARK_DIM : LIGHT_LIFT + (1 - LIGHT_LIFT) * luminance
}

/**
 * Two materials, as on Apple platforms. `regular` is for panes full of text (tool panels,
 * dialogs, menus): it keeps the theme and turns milkier over a dark backdrop. `clear` is
 * for small controls (the clock bar, chips): it stays see-through and instead switches to
 * dark glass while the backdrop is dark, see `glassTone`.
 */
export type GlassMaterial = 'regular' | 'clear'

/** Below this median backdrop luminance a light-theme control turns into dark glass. */
export const TONE_TO_DARK = 0.07
/** And above this it turns back; the gap keeps a control from flickering at the limb. */
export const TONE_TO_LIGHT = 0.16

/**
 * Which glass a pane should be right now.
 *
 * @param median Median backdrop luminance behind the pane.
 * @param current The tone it has now, for hysteresis.
 * @param themeDark Dark themes are always dark glass.
 * @param material Only `clear` controls switch; `regular` panes keep the theme.
 */
export function glassTone(
  median: number,
  current: 'light' | 'dark',
  themeDark: boolean,
  material: GlassMaterial,
): 'light' | 'dark' {
  if (themeDark) return 'dark'
  if (material === 'regular') return 'light'
  if (current === 'dark') return median > TONE_TO_LIGHT ? 'light' : 'dark'
  return median < TONE_TO_DARK ? 'dark' : 'light'
}

/**
 * Least tint that keeps text readable over a backdrop.
 *
 * Light panes carry dark text, so the blend `a·surface + (1−a)·backdrop` must stay above a
 * target luminance; dark panes carry light text and must stay below one. `intensity` (0..1)
 * trades contrast for clarity inside a range that stays readable.
 *
 * @param backdrop Luminance of the backdrop behind the pane (the worst spot, not the mean).
 * @param dark Whether the pane uses a dark theme (light text).
 * @param surface Luminance of the theme's surface colour.
 * @param intensity 0 = most opaque, 1 = clearest.
 * @param material `regular` light panes aim brighter, so they read as frosted, not grey.
 */
export function glassAlpha(
  backdrop: number,
  dark: boolean,
  surface: number,
  intensity: number,
  material: GlassMaterial = 'regular',
): number {
  const seen = toneBackdrop(backdrop, dark)
  let alpha: number
  if (dark) {
    const target = 0.05 + 0.08 * intensity
    alpha = seen <= target ? 0 : (seen - target) / Math.max(seen - surface, 1e-6)
  } else {
    const target = (material === 'regular' ? 0.72 : 0.52) - 0.14 * intensity
    alpha = seen >= target ? 0 : (target - seen) / Math.max(surface - seen, 1e-6)
  }
  const floor = MIN_ALPHA + 0.14 * (1 - intensity)
  return Math.min(MAX_ALPHA, Math.max(floor, alpha))
}

/** Inclusive-exclusive cell bounds of a screen rectangle on the sampling grid. */
export interface GridRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Where `rect` falls on a `width`×`height` grid laid over `canvas`; null if it misses. */
export function gridRect(
  rect: { left: number; top: number; right: number; bottom: number },
  canvas: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): GridRect | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null
  const x0 = Math.max(0, Math.floor(((rect.left - canvas.left) / canvas.width) * width))
  const y0 = Math.max(0, Math.floor(((rect.top - canvas.top) / canvas.height) * height))
  const x1 = Math.min(width, Math.ceil(((rect.right - canvas.left) / canvas.width) * width))
  const y1 = Math.min(height, Math.ceil(((rect.bottom - canvas.top) / canvas.height) * height))
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

/**
 * A percentile of the luminance of RGBA pixels inside a grid rectangle.
 *
 * Text fails where the backdrop is worst, not on average: dark text over a light pane
 * fails on the darkest spot, light text over a dark pane on the brightest, so callers ask
 * for a low or a high percentile.
 */
export function regionLuminance(
  pixels: ArrayLike<number>,
  width: number,
  region: GridRect,
  percentile: number,
): number {
  const values: number[] = []
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      const i = (y * width + x) * 4
      values.push(relativeLuminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!))
    }
  }
  values.sort((a, b) => a - b)
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.round(percentile * (values.length - 1))),
  )
  return values[index] ?? 0
}
