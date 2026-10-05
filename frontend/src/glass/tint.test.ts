import { describe, expect, it } from 'vitest'
import {
  glassAlpha,
  glassTone,
  gridRect,
  hexLuminance,
  MAX_ALPHA,
  MIN_ALPHA,
  regionLuminance,
  relativeLuminance,
  toneBackdrop,
} from './tint'

const WHITE = hexLuminance('#ffffff')
const DARK_SURFACE = hexLuminance('#1c2633')

/** Luminance of the blend a·surface + (1−a)·backdrop the eye actually sees. */
function seen(alpha: number, surface: number, backdrop: number, dark: boolean) {
  return alpha * surface + (1 - alpha) * toneBackdrop(backdrop, dark)
}

function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('relativeLuminance', () => {
  it('spans black to white', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0)
    expect(WHITE).toBeCloseTo(1)
    expect(hexLuminance('#808080')).toBeCloseTo(0.216, 2)
  })
})

describe('glassAlpha', () => {
  const text = { light: hexLuminance('#172b40'), dark: hexLuminance('#e6edf5') }

  it('keeps dark text readable on light glass over any backdrop', () => {
    for (const backdrop of [0, 0.05, 0.2, 0.5, 1]) {
      for (const intensity of [0, 0.5, 1]) {
        const alpha = glassAlpha(backdrop, false, WHITE, intensity)
        expect(contrast(text.light, seen(alpha, WHITE, backdrop, false))).toBeGreaterThan(4.5)
      }
    }
  })

  it('keeps light text readable on dark glass over any backdrop', () => {
    for (const backdrop of [0, 0.05, 0.2, 0.5, 1]) {
      for (const intensity of [0, 0.5, 1]) {
        const alpha = glassAlpha(backdrop, true, DARK_SURFACE, intensity)
        expect(contrast(text.dark, seen(alpha, DARK_SURFACE, backdrop, true))).toBeGreaterThan(4.5)
      }
    }
  })

  it('keeps clear light controls readable too', () => {
    for (const backdrop of [0.1, 0.3, 1]) {
      const alpha = glassAlpha(backdrop, false, WHITE, 1, 'clear')
      expect(contrast(text.light, seen(alpha, WHITE, backdrop, false))).toBeGreaterThan(4.5)
    }
  })

  it('clears up where the backdrop already gives contrast', () => {
    expect(glassAlpha(1, false, WHITE, 0.5)).toBeLessThan(glassAlpha(0, false, WHITE, 0.5))
    expect(glassAlpha(0, true, DARK_SURFACE, 0.5)).toBeLessThan(
      glassAlpha(0.6, true, DARK_SURFACE, 0.5),
    )
  })

  it('stays within bounds and follows intensity', () => {
    for (const backdrop of [0, 1]) {
      for (const dark of [false, true]) {
        const surface = dark ? DARK_SURFACE : WHITE
        const clear = glassAlpha(backdrop, dark, surface, 1)
        const opaque = glassAlpha(backdrop, dark, surface, 0)
        expect(clear).toBeGreaterThanOrEqual(MIN_ALPHA)
        expect(opaque).toBeLessThanOrEqual(MAX_ALPHA)
        expect(clear).toBeLessThanOrEqual(opaque)
      }
    }
  })
})

describe('gridRect / regionLuminance', () => {
  const canvas = { left: 100, top: 0, width: 400, height: 200 }

  it('maps a screen rectangle onto the sampling grid', () => {
    expect(gridRect({ left: 100, top: 0, right: 300, bottom: 100 }, canvas, 40, 20)).toEqual({
      x0: 0,
      y0: 0,
      x1: 20,
      y1: 10,
    })
    expect(gridRect({ left: 0, top: 0, right: 90, bottom: 50 }, canvas, 40, 20)).toBeNull()
  })

  it('takes a percentile of the region, not the mean', () => {
    // 2×1 grid: one black and one white pixel.
    const pixels = [0, 0, 0, 255, 255, 255, 255, 255]
    const region = { x0: 0, y0: 0, x1: 2, y1: 1 }
    expect(regionLuminance(pixels, 2, region, 0)).toBe(0)
    expect(regionLuminance(pixels, 2, region, 1)).toBeCloseTo(1)
  })
})

describe('glassTone', () => {
  it('switches clear controls to dark glass over a dark backdrop, with hysteresis', () => {
    expect(glassTone(0.02, 'light', false, 'clear')).toBe('dark')
    expect(glassTone(0.1, 'dark', false, 'clear')).toBe('dark')
    expect(glassTone(0.1, 'light', false, 'clear')).toBe('light')
    expect(glassTone(0.3, 'dark', false, 'clear')).toBe('light')
  })

  it('keeps regular panes on the theme, and dark themes dark', () => {
    expect(glassTone(0, 'light', false, 'regular')).toBe('light')
    expect(glassTone(1, 'light', true, 'clear')).toBe('dark')
  })
})
