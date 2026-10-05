import { describe, expect, it } from 'vitest'
import SOURCES from './SOURCES.md?raw'
import { flagUrl } from './flags'
import {
  NETWORKS,
  STATION_PRESETS,
  countryName,
  findPreset,
  presetOf,
  presetToInput,
  presetsByCountry,
  searchPresets,
  stationLabel,
} from './presets'
import { NETWORK_IDS } from './types'
import type { Station } from '../api/types'

// Mirrors StationCreate in src/soda/api/schemas.py; the two cannot share a constant, so
// this test stands in for the contract.
const LIMITS = {
  lat_deg: [-90, 90],
  lon_deg: [-180, 180],
  alt_m: [-500, 9000],
  min_elev_deg: [0, 89],
} as const

describe('station presets', () => {
  it('ships a usable number of stations', () => {
    expect(STATION_PRESETS.length).toBeGreaterThanOrEqual(35)
  })

  it('uses unique, storable ids', () => {
    const ids = STATION_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    // The backend accepts preset_id only in this shape.
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,48}$/)
  })

  it('keeps every field inside what the API accepts', () => {
    for (const preset of STATION_PRESETS) {
      for (const [field, [low, high]] of Object.entries(LIMITS)) {
        const value = preset[field as keyof typeof LIMITS]
        expect(Number.isFinite(value), `${preset.id}.${field}`).toBe(true)
        expect(value, `${preset.id}.${field}`).toBeGreaterThanOrEqual(low)
        expect(value, `${preset.id}.${field}`).toBeLessThanOrEqual(high)
      }
      expect(preset.name.ko.length, preset.id).toBeGreaterThan(0)
      expect(preset.name.en.length, preset.id).toBeGreaterThan(0)
      expect(preset.name.ko.length, preset.id).toBeLessThanOrEqual(60)
      expect(preset.name.en.length, preset.id).toBeLessThanOrEqual(60)
      expect(preset.country, preset.id).toMatch(/^[A-Z]{2}$/)
      expect(NETWORK_IDS, preset.id).toContain(preset.network)
    }
  })

  it('records a traceable source and date for every station', () => {
    for (const preset of STATION_PRESETS) {
      expect(preset.source, preset.id).toMatch(/^https:\/\//)
      expect(preset.retrieved, preset.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('lists every station in SOURCES.md', () => {
    const missing = STATION_PRESETS.filter((preset) => !SOURCES.includes(`\`${preset.id}\``))
    expect(missing.map((preset) => preset.id)).toEqual([])
  })

  it('never invents an English label that is Korean', () => {
    for (const preset of STATION_PRESETS) {
      expect(preset.name.en, preset.id).not.toMatch(/[ㄱ-ㆎ가-힣]/)
      expect(NETWORKS[preset.network].short).not.toMatch(/[ㄱ-ㆎ가-힣]/)
    }
  })

  it('names every network it uses', () => {
    for (const { network } of STATION_PRESETS) expect(NETWORKS[network]).toBeTruthy()
  })

  it('has a flag for every country it uses', () => {
    const missing = [...new Set(STATION_PRESETS.map((preset) => preset.country))].filter(
      (country) => !flagUrl(country),
    )
    expect(missing).toEqual([])
    expect(flagUrl('ZZ')).toBeNull()
  })
})

describe('preset helpers', () => {
  it('turns a preset into a station body', () => {
    const preset = findPreset('dsn-goldstone')!
    expect(presetToInput(preset, 'en')).toMatchObject({
      name: 'Goldstone (DSN)',
      preset_id: 'dsn-goldstone',
      az_mask: [],
    })
    expect(presetToInput(preset, 'ko').name).toBe('골드스톤 (DSN)')
  })

  it('returns null for an unknown or absent preset id', () => {
    expect(findPreset('nope')).toBeNull()
    expect(findPreset(null)).toBeNull()
    expect(findPreset(undefined)).toBeNull()
  })

  it('follows the catalogue for a preset station and the stored name otherwise', () => {
    const base: Station = {
      id: 1,
      name: '내가 붙인 이름',
      lat_deg: 0,
      lon_deg: 0,
      alt_m: 0,
      min_elev_deg: 10,
      preset_id: null,
      az_mask: [],
    }
    expect(stationLabel(base, 'en')).toBe('내가 붙인 이름')
    const linked = { ...base, preset_id: 'ksat-svalbard' }
    expect(stationLabel(linked, 'en')).toBe('Svalbard (SvalSat)')
    expect(stationLabel(linked, 'ko')).toBe('스발바르 (SvalSat)')
  })

  describe('rows saved before preset_id existed', () => {
    const naro = findPreset('kari-naro')!
    const legacy: Station = {
      id: 3,
      name: '나로우주센터',
      lat_deg: naro.lat_deg,
      lon_deg: naro.lon_deg,
      alt_m: 0,
      min_elev_deg: 5,
      preset_id: null,
      az_mask: [],
    }

    it('are linked by catalogue name and coordinate', () => {
      expect(presetOf(legacy)?.id).toBe('kari-naro')
      expect(presetOf({ ...legacy, name: 'Naro Space Center' })?.id).toBe('kari-naro')
      expect(stationLabel(legacy, 'en')).toBe('Naro Space Center')
    })

    it("stay the reader's own once renamed or moved", () => {
      expect(presetOf({ ...legacy, name: '우리 나로' })).toBeNull()
      expect(presetOf({ ...legacy, lat_deg: naro.lat_deg + 0.01 })).toBeNull()
      // The old seed: a city-hall coordinate that matches no catalogue site.
      const seed = { ...legacy, name: '대전', lat_deg: 36.3504, lon_deg: 127.3845 }
      expect(presetOf(seed)).toBeNull()
      expect(stationLabel(seed, 'en')).toBe('대전')
    })

    it('does not guess past an explicit but unknown preset id', () => {
      expect(presetOf({ ...legacy, preset_id: 'retired-site' })).toBeNull()
    })
  })

  it("groups presets by country in the reader's alphabet order", () => {
    for (const locale of ['ko', 'en'] as const) {
      const groups = presetsByCountry(STATION_PRESETS, locale)
      expect(groups.flatMap((group) => group.presets)).toHaveLength(STATION_PRESETS.length)
      for (const group of groups) {
        expect(group.presets.length, group.country).toBeGreaterThan(0)
        expect(group.presets.every((preset) => preset.country === group.country)).toBe(true)
      }
      const names = groups.map((group) => group.name)
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, locale)))
    }
    expect(presetsByCountry(searchPresets('svalbard', 'en'), 'en').map((g) => g.country)).toEqual([
      'NO',
    ])
    expect(presetsByCountry([], 'en')).toEqual([])
  })

  it('searches over both names, the network, and the country', () => {
    expect(searchPresets('svalbard', 'en').map((p) => p.id)).toContain('ksat-svalbard')
    expect(searchPresets('스발바르', 'ko').map((p) => p.id)).toContain('ksat-svalbard')
    expect(searchPresets('ESTRACK', 'en').every((p) => p.network === 'estrack')).toBe(true)
    expect(searchPresets('  ', 'en')).toHaveLength(STATION_PRESETS.length)
    expect(searchPresets('zzzz', 'en')).toHaveLength(0)
  })

  it('renders country codes in the reader language', () => {
    expect(countryName('KR', 'en')).toBe('South Korea')
    expect(countryName('KR', 'ko')).toBe('대한민국')
    expect(countryName('AQ', 'en')).toBe('Antarctica')
    // A malformed code makes Intl throw; the helper must hand back the code instead.
    expect(countryName('ZZZ', 'en')).toBe('ZZZ')
  })
})
