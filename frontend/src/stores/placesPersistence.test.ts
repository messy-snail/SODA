import { describe, expect, it } from 'vitest'
import { CITY_HEIGHT_M, DEFAULT_HOME } from '../places/camera'
import {
  defaultPlaces,
  loadPlaces,
  MAX_NAME_LENGTH,
  PLACES_STORAGE_KEY,
  PLACES_VERSION,
  sanitizePlaces,
  savePlaces,
} from './placesPersistence'

function memoryStorage() {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
  }
}

const pin = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  lon_deg: 127,
  lat_deg: 37,
  height_m: 5e5,
  icon: 'star',
  colorIndex: 2,
  visible: false,
  ...extra,
})

describe('sanitizePlaces', () => {
  it('falls back to defaults for missing or malformed data', () => {
    expect(sanitizePlaces(null)).toEqual(defaultPlaces())
    expect(sanitizePlaces('x')).toEqual(defaultPlaces())
    expect(sanitizePlaces({ version: 2, home: { lon_deg: 'a' } }).home).toEqual(DEFAULT_HOME)
  })

  it('keeps valid v2 pins and repairs or drops bad ones', () => {
    const places = sanitizePlaces({
      version: PLACES_VERSION,
      pins: [
        pin('a'),
        pin('a', { name: 'duplicate id' }),
        pin('b', { name: '   ' }),
        pin('c', { lat_deg: 95 }),
        pin('d', { icon: 'unicorn', colorIndex: -1, visible: 'yes', name: 'x'.repeat(99) }),
        pin('e', { lon_deg: 190, height_m: undefined }),
      ],
    })
    expect(places.pins.map((p) => p.id)).toEqual(['a', 'd', 'e'])
    expect(places.pins[0]).toMatchObject({ icon: 'star', colorIndex: 2, visible: false })
    expect(places.pins[1]).toMatchObject({ icon: 'pin', colorIndex: 0, visible: true })
    expect(places.pins[1]!.name).toHaveLength(MAX_NAME_LENGTH)
    expect(places.pins[2]).toMatchObject({ lon_deg: -170, height_m: CITY_HEIGHT_M })
  })

  it('turns v1 favourites into star pins and landmarks into plain pins', () => {
    const places = sanitizePlaces({
      home: { lon_deg: 10, lat_deg: 20, height_m: 3e6 },
      bookmarks: [{ id: 'b1', name: 'Korea view', lon_deg: 127.9, lat_deg: 36.5, height_m: 9e5 }],
      landmarks: [{ id: 'm1', name: 'KARI', lon_deg: 127.36, lat_deg: 36.37, colorIndex: 0 }],
    })
    expect(places.version).toBe(PLACES_VERSION)
    expect(places.home).toEqual({ lon_deg: 10, lat_deg: 20, height_m: 3e6 })
    expect(places.pins).toEqual([
      {
        id: 'b1',
        name: 'Korea view',
        lon_deg: 127.9,
        lat_deg: 36.5,
        height_m: 9e5,
        icon: 'star',
        colorIndex: 0,
        visible: true,
      },
      {
        id: 'm1',
        name: 'KARI',
        lon_deg: 127.36,
        lat_deg: 36.37,
        height_m: CITY_HEIGHT_M,
        icon: 'pin',
        colorIndex: 1,
        visible: true,
      },
    ])
  })
})

describe('loadPlaces / savePlaces', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage()
    const places = defaultPlaces()
    places.home = { lon_deg: 10, lat_deg: 20, height_m: 3e6 }
    places.pins.push({ ...pin('a'), icon: 'rocket' } as never)
    savePlaces(storage, places)
    expect(storage.entries.has(PLACES_STORAGE_KEY)).toBe(true)
    expect(loadPlaces(storage)).toEqual(places)
  })

  it('survives broken JSON and no storage', () => {
    const storage = memoryStorage()
    storage.entries.set(PLACES_STORAGE_KEY, '{')
    expect(loadPlaces(storage)).toEqual(defaultPlaces())
    expect(loadPlaces(null)).toEqual(defaultPlaces())
  })
})
