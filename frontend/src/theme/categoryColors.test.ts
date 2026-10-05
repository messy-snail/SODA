import { describe, expect, it } from 'vitest'
import {
  defaultCloudStyle,
  normalizeHex,
  resolveCategoryColors,
  sanitizeCloudStyle,
} from './categoryColors'
import { presets } from './presets'

describe('normalizeHex', () => {
  it('accepts opaque hex colors only', () => {
    expect(normalizeHex('#64B5F6')).toBe('#64b5f6')
    expect(normalizeHex('#64b5f6FF')).toBe('#64b5f6')
    expect(normalizeHex('#64b5f680')).toBeNull()
    expect(normalizeHex('#fff')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex(42)).toBeNull()
  })
})

describe('sanitizeCloudStyle', () => {
  it('falls back to defaults for missing or malformed storage', () => {
    expect(sanitizeCloudStyle(undefined)).toEqual(defaultCloudStyle())
    expect(sanitizeCloudStyle('oops')).toEqual(defaultCloudStyle())
    expect(sanitizeCloudStyle({ pointSize: 'big', opacity: Number.NaN })).toEqual(
      defaultCloudStyle(),
    )
  })

  it('clamps ranges and drops unknown or duplicate entries', () => {
    const style = sanitizeCloudStyle({
      pointSize: 40,
      opacity: 0,
      colors: { LEO: '#ABCDEF', MEO: 'green', SUN: '#123456' },
      hidden: ['DEBRIS', 'DEBRIS', 'SUN', 3],
    })
    expect(style).toEqual({
      pointSize: 8,
      opacity: 0.1,
      colors: { LEO: '#abcdef' },
      hidden: ['DEBRIS'],
    })
  })

  it('returns fresh objects so stores never share defaults', () => {
    const a = sanitizeCloudStyle({})
    a.hidden.push('LEO')
    expect(sanitizeCloudStyle({}).hidden).toEqual([])
  })
})

describe('resolveCategoryColors', () => {
  it('overrides only the categories the user picked', () => {
    const base = presets[0]!.globe.categories
    const resolved = resolveCategoryColors(base, { GEO: '#010203' })
    expect(resolved.GEO).toBe('#010203')
    expect(resolved.LEO).toBe(base.LEO)
    expect(base.GEO).not.toBe('#010203')
  })
})
