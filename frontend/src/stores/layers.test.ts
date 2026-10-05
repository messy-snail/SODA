import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readPreferences, useLayersStore } from './layers'

const STORAGE_KEY = 'soda.layers'

/** The jsdom environment leaves `localStorage` an empty object, so stand one up per test. */
function fakeStorage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  }
}

function store(prefs: Record<string, unknown> | string) {
  localStorage.setItem(STORAGE_KEY, typeof prefs === 'string' ? prefs : JSON.stringify(prefs))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  setActivePinia(createPinia())
})

afterEach(() => vi.unstubAllGlobals())

describe('readPreferences', () => {
  it('starts a fresh browser on the cube marker', () => {
    expect(readPreferences().markerStyle.shape).toBe('cube')
  })

  it('migrates a pre-version browser off the old point default, keeping its sizes', () => {
    store({ markerStyle: { shape: 'point', size_m: 40, minimum_size_px: 96 } })

    const prefs = readPreferences()

    expect(prefs.markerStyle).toEqual({ shape: 'cube', size_m: 40, minimum_size_px: 96 })
    expect(prefs.version).toBe(1)
  })

  it('leaves a point chosen after the migration alone', () => {
    store({ version: 1, markerStyle: { shape: 'point', size_m: 5, minimum_size_px: 48 } })

    expect(readPreferences().markerStyle.shape).toBe('point')
  })

  it('keeps unrelated stored preferences across the migration', () => {
    store({ showStations: false, markerStyle: { shape: 'point', size_m: 5, minimum_size_px: 48 } })

    const prefs = readPreferences()

    expect(prefs.showStations).toBe(false)
    expect(prefs.markerStyle.shape).toBe('cube')
  })

  it('falls back to defaults when storage holds garbage', () => {
    store('{ not json')

    expect(readPreferences().markerStyle.shape).toBe('cube')
  })
})

describe('useLayersStore', () => {
  it('starts in ECEF despite previous frame preferences', () => {
    store({ frame: 'inertial', lighting: false })

    const layers = useLayersStore()

    expect(layers.prefs.frame).toBe('fixed')
    expect(layers.effectiveFrame).toBe('fixed')
    expect(layers.prefs.lighting).toBe(false)
  })
})

describe('user imagery preferences', () => {
  it('shows imagery on zoom by default and adds the keys without a version bump', () => {
    store({ version: 1, markerStyle: { shape: 'point', size_m: 5, minimum_size_px: 48 } })

    const prefs = readPreferences()

    expect(prefs.showUserImagery).toBe(true)
    expect(prefs.imagery).toEqual({})
    // A stored browser keeps the marker it chose: a version bump would have reset it.
    expect(prefs.markerStyle.shape).toBe('point')
  })

  it('repairs stored entries', () => {
    store({ version: 1, imagery: { u1: { opacity: 2 }, '../x': { opacity: 1 } } })

    expect(readPreferences().imagery).toEqual({ u1: { opacity: 1 } })
  })

  it('fades and forgets sets', () => {
    const layers = useLayersStore()
    expect(layers.imageryPref('u1')).toEqual({ opacity: 1 })

    layers.setImageryOpacity('u1', 0.4)
    layers.setImageryOpacity('u2', 3)
    expect(layers.imageryPref('u1')).toEqual({ opacity: 0.4 })
    expect(layers.imageryPref('u2')).toEqual({ opacity: 1 })

    layers.pruneImagery(['u2'])
    expect(layers.prefs.imagery).toEqual({ u2: { opacity: 1 } })
  })
})
