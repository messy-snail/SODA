import { describe, expect, it } from 'vitest'
import { parseAppearance } from './appearance'

describe('parseAppearance', () => {
  it('defaults to medium glass for missing or broken storage', () => {
    for (const raw of [null, '', '{', '[]']) {
      expect(parseAppearance(raw)).toEqual({ glass: true, intensity: 0.5, refraction: true })
    }
  })

  it('keeps a choice and clamps the intensity', () => {
    expect(parseAppearance('{"glass":false,"intensity":0.2,"refraction":false}')).toEqual({
      glass: false,
      intensity: 0.2,
      refraction: false,
    })
    expect(parseAppearance('{"intensity":-1}').intensity).toBe(0)
    expect(parseAppearance('{"intensity":3}').intensity).toBe(1)
  })

  it('ignores the raw opacity older versions stored', () => {
    expect(parseAppearance('{"alpha":0.35}').intensity).toBe(0.5)
  })
})
