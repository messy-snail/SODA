import { describe, expect, it } from 'vitest'
import { MAX_RECENT, parsePicks, withRecent } from './satellitePicks'

describe('satellite picks', () => {
  const pick = (id: number) => ({ key: `norad:${id}`, name: `SAT ${id}` })

  it('moves a repeat pick to the front and caps the list', () => {
    let list = [1, 2, 3, 4, 5].map(pick)
    list = withRecent(list, pick(3))
    expect(list.map((item) => item.key)).toEqual([3, 1, 2, 4, 5].map((id) => `norad:${id}`))
    list = withRecent(list, pick(9))
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]!.key).toBe('norad:9')
  })

  it('reads stored picks and drops what does not check out', () => {
    const raw = JSON.stringify({
      recent: [pick(1), { key: 'custom:2', name: 'Mine' }, { key: 'bad', name: 'x' }, 7],
      favorites: [pick(5), { key: 'norad:6' }],
    })
    expect(parsePicks(raw)).toEqual({
      recent: [pick(1), { key: 'custom:2', name: 'Mine' }],
      favorites: [pick(5)],
    })
    expect(parsePicks('{')).toEqual({ recent: [], favorites: [] })
    expect(parsePicks(null)).toEqual({ recent: [], favorites: [] })
  })
})
