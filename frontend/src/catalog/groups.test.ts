import { describe, expect, it } from 'vitest'
import { groupLabel } from './groups'

describe('group labels', () => {
  it('names known groups and falls back to the raw name', () => {
    expect(groupLabel('weather').ko).toBe('기상')
    expect(groupLabel('resource').en).toBe('Earth resources')
    expect(groupLabel('new-group')).toEqual({ ko: 'new-group', en: 'new-group' })
  })
})
