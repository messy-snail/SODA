import { describe, expect, it } from 'vitest'
import { clearSodaKeys } from './resetClientState'

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

describe('clearSodaKeys', () => {
  it('removes only soda.* keys from every storage', () => {
    const local = memoryStorage({ 'soda.layout': '{}', 'soda.sensor.25544': '{}', other: 'x' })
    const session = memoryStorage({ 'soda.session.v1': '{}', sodapop: 'y' })
    const removed = clearSodaKeys([local, session])
    expect(removed.sort()).toEqual(['soda.layout', 'soda.sensor.25544', 'soda.session.v1'])
    expect([...local.map.keys()]).toEqual(['other'])
    expect([...session.map.keys()]).toEqual(['sodapop'])
  })

  it('skips a storage that throws', () => {
    const blocked = {
      get length(): number {
        throw new Error('blocked')
      },
      key: () => null,
      removeItem: () => undefined,
    }
    const local = memoryStorage({ 'soda.theme': 'dark' })
    expect(clearSodaKeys([blocked, local])).toEqual(['soda.theme'])
  })
})
