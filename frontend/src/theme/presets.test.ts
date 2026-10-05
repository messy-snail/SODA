import { describe, expect, it } from 'vitest'
import { presets } from './presets'

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('theme presets', () => {
  // Vuetify paints tooltips with these two; a missing `on-*` falls back to its own default.
  it.each(presets.map((preset) => [preset.id, preset] as const))(
    '%s keeps tooltip text legible',
    (_, preset) => {
      const background = preset.colors['surface-variant']!
      const text = preset.colors['on-surface-variant']!
      expect(text).toBeDefined()
      expect(contrast(background, text)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
