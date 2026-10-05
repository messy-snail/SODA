import { describe, expect, it } from 'vitest'
import { MAX_BASKET, toggledEntry, withEntry, withoutEntry } from './basketItems'

const entry = (id: number) => ({ key: `norad:${id}`, name: `SAT ${id}` })

describe('basket items', () => {
  it('adds once and keeps the order picks were made in', () => {
    let list = withEntry([], entry(1)).list
    list = withEntry(list, entry(2)).list
    const again = withEntry(list, entry(1))
    expect(again.added).toBe(false)
    expect(again.list.map((item) => item.key)).toEqual(['norad:1', 'norad:2'])
  })

  it('refuses a pick once full', () => {
    const list = Array.from({ length: MAX_BASKET }, (_, index) => entry(index + 1))
    const change = withEntry(list, entry(99))
    expect(change).toMatchObject({ added: false, full: true })
    expect(change.list).toHaveLength(MAX_BASKET)
  })

  it('toggles and removes by key', () => {
    const list = [entry(1), entry(2)]
    expect(toggledEntry(list, entry(1)).list).toEqual([entry(2)])
    expect(toggledEntry(list, entry(3)).list).toEqual([entry(1), entry(2), entry(3)])
    expect(withoutEntry(list, 'norad:2')).toEqual([entry(1)])
  })
})
