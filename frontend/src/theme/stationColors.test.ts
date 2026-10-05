import { describe, expect, it } from 'vitest'
import { presets } from './presets'
import { stationColorHex } from './stationColors'

const palette = ['#a', '#b', '#c']

describe('stationColorHex', () => {
  it('hands out palette entries in order', () => {
    expect([0, 1, 2].map((i) => stationColorHex(i, palette))).toEqual(palette)
  })

  it('wraps past the end of the palette', () => {
    expect(stationColorHex(3, palette)).toBe('#a')
    expect(stationColorHex(7, palette)).toBe('#b')
  })

  it('survives a negative or empty input', () => {
    expect(stationColorHex(-1, palette)).toBe('#c')
    expect(stationColorHex(0, [])).toBe('#888888')
  })
})

describe('theme presets', () => {
  it('give every preset a usable station palette', () => {
    for (const preset of presets) {
      expect(preset.globe.stationPalette.length).toBeGreaterThanOrEqual(6)
      expect(new Set(preset.globe.stationPalette).size).toBe(preset.globe.stationPalette.length)
      for (const color of preset.globe.stationPalette) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('give every preset border, country label and landmark colours', () => {
    for (const preset of presets) {
      const { border, countryLabel, countryLabelOutline, pinPalette } = preset.globe
      for (const color of [border, countryLabel, countryLabelOutline, ...pinPalette]) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      }
      expect(pinPalette.length).toBeGreaterThanOrEqual(6)
      expect(preset.globe.countryTintPalette).toHaveLength(7)
      for (const color of preset.globe.countryTintPalette) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(preset.globe.countryTintOpacity).toBeGreaterThan(0)
      expect(preset.globe.countryTintOpacity).toBeLessThanOrEqual(0.5)
      expect(new Set(pinPalette).size).toBe(pinPalette.length)
    }
  })

  it('keeps white pin glyphs readable and gives name tags their own colours', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi! + 0.05) / (lo! + 0.05)
    }
    for (const preset of presets) {
      for (const color of preset.globe.pinPalette) {
        expect(contrast(color, '#ffffff'), `${preset.id} ${color}`).toBeGreaterThanOrEqual(3)
      }
      const { chipBackground, chipText } = preset.globe
      expect(contrast(chipBackground, chipText), preset.id).toBeGreaterThanOrEqual(7)
    }
  })

  it('keeps the first station colour clear of the first orbit colour', () => {
    for (const preset of presets) {
      expect(preset.globe.stationPalette[0]).not.toBe(preset.globe.orbitPalette[0])
    }
  })
})
