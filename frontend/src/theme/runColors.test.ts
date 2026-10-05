import { describe, expect, it } from 'vitest'
import { orbitColorHex } from './runColors'

describe('orbit colours', () => {
  const palette = ['#111111', '#222222', '#333333']

  it('takes the colour at the index and wraps past the palette', () => {
    expect(orbitColorHex(1, palette)).toBe('#222222')
    expect(orbitColorHex(4, palette)).toBe('#222222')
    expect(orbitColorHex(-1, palette)).toBe('#333333')
  })

  it('falls back to grey without a palette', () => {
    expect(orbitColorHex(0, [])).toBe('#888888')
  })
})
