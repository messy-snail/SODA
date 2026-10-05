import { describe, expect, it } from 'vitest'
import { IMAGERY_BAND, insertIndex } from './imageryOrder'

const { user, tint, coverage, visibility, shade } = IMAGERY_BAND

describe('insertIndex', () => {
  it('puts the first overlay right above the basemap', () => {
    expect(insertIndex([0], user)).toBe(1)
    expect(insertIndex([0], visibility)).toBe(1)
  })

  it('keeps user imagery below the tint and the visibility areas', () => {
    expect(insertIndex([0, tint], user)).toBe(1)
    expect(insertIndex([0, tint, visibility], user)).toBe(1)
    expect(insertIndex([0, visibility], tint)).toBe(1)
  })

  it('stacks a later layer of the same band above the earlier one', () => {
    expect(insertIndex([0, user, tint], user)).toBe(2)
    expect(insertIndex([0, user, user, tint, visibility], user)).toBe(3)
  })

  it('puts the tint above user imagery and the visibility areas on top', () => {
    expect(insertIndex([0, user, user], tint)).toBe(3)
    expect(insertIndex([0, user, tint], visibility)).toBe(3)
  })

  it('stays above both basemaps while one replaces the other', () => {
    expect(insertIndex([0, 0, tint], user)).toBe(2)
  })

  it('keeps the night shading above everything that arrives later', () => {
    expect(insertIndex([0, shade], user)).toBe(1)
    expect(insertIndex([0, user, shade], tint)).toBe(2)
    expect(insertIndex([0, user, tint, shade], visibility)).toBe(3)
    expect(insertIndex([0, user, tint, visibility], shade)).toBe(4)
  })

  it('puts the coverage map above the tint and below the visibility areas', () => {
    expect(insertIndex([0, user, tint, visibility, shade], coverage)).toBe(3)
    expect(insertIndex([0, coverage], tint)).toBe(1)
    expect(insertIndex([0, coverage], visibility)).toBe(2)
  })

  it('handles a globe with no layers yet', () => {
    expect(insertIndex([], user)).toBe(0)
  })
})
