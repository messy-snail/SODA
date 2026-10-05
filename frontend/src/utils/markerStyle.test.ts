import { describe, expect, it } from 'vitest'
import { defaultMarkerStyle, sanitizeMarkerStyle } from './markerStyle'

describe('sanitizeMarkerStyle', () => {
  it('keeps a valid stored style', () => {
    const style = { shape: 'cube', size_m: 12, minimum_size_px: 64 }
    expect(sanitizeMarkerStyle(style)).toEqual(style)
  })

  it('falls back to defaults for malformed values and clamps ranges', () => {
    expect(sanitizeMarkerStyle(null)).toEqual(defaultMarkerStyle())
    expect(sanitizeMarkerStyle({ shape: 'glb', size_m: 'big', minimum_size_px: NaN })).toEqual(
      defaultMarkerStyle(),
    )
    expect(sanitizeMarkerStyle({ shape: 'sphere', size_m: 0, minimum_size_px: 999 })).toEqual({
      shape: 'sphere',
      size_m: 1,
      minimum_size_px: 128,
    })
  })
})
