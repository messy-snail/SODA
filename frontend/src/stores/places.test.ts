import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlacesStore } from './places'

// Naming data is fetched from public/geo; without it pins fall back to numbered names.
vi.mock('../places/geoData', () => ({
  loadCities: () => Promise.reject(new Error('offline')),
  loadCountries: () => Promise.reject(new Error('offline')),
  loadShapes: () => Promise.reject(new Error('offline')),
}))

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  setActivePinia(createPinia())
})

afterEach(() => vi.unstubAllGlobals())

describe('pin candidate', () => {
  it('a globe click becomes the candidate', () => {
    const places = usePlacesStore()
    places.receiveClick(127, 37.5)
    expect(places.draft).toMatchObject({ lon_deg: 127, lat_deg: 37.5 })
    expect(places.draft?.name).toBeUndefined()
  })

  it('a search result carries its name and icon, and each call is a new request', () => {
    const places = usePlacesStore()
    places.setDraft(139.7, 35.7, { name: 'Tokyo', icon: 'building' })
    const first = places.draft!.seq
    places.setDraft(139.7, 35.7, { name: 'Tokyo', icon: 'building' })
    expect(places.draft).toMatchObject({ name: 'Tokyo', icon: 'building' })
    expect(places.draft!.seq).toBeGreaterThan(first)
  })

  it('clearing drops the candidate without adding a pin', () => {
    const places = usePlacesStore()
    places.setDraft(0, 0)
    places.clearDraft()
    expect(places.draft).toBeNull()
    expect(places.saved.pins).toHaveLength(0)
  })
})
