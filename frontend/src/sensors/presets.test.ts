import { describe, expect, it } from 'vitest'
import {
  fromSavedPreset,
  matchingPreset,
  presetSummary,
  sensorPresets,
  toSavedPresetInput,
} from './presets'

describe('presetSummary', () => {
  it('shows the width and the steering limit', () => {
    expect(presetSummary(sensorPresets[0].settings)).toBe('12 km · ±30°')
  })

  it('drops the steering limit for a nadir-only sensor and shows FOV in FOV mode', () => {
    const wide = sensorPresets.find((preset) => preset.id === 'wide')!.settings
    expect(presetSummary(wide)).toBe('1500 km')
    expect(presetSummary({ ...wide, mode: 'fov' })).toBe('FOV 110°')
  })
})

describe('matchingPreset', () => {
  it('finds a preset by its values and nothing once one is edited', () => {
    const settings = { ...sensorPresets[1].settings }
    expect(matchingPreset(settings)).toBe('mr-eo')
    expect(matchingPreset({ ...settings, minSunElevDeg: 11 })).toBeNull()
  })
})

describe('saved presets', () => {
  const saved = {
    id: 7,
    name: 'My EO',
    mode: 'fov' as const,
    swath_km: 30,
    fov_deg: 3.5,
    max_off_nadir_deg: 25,
    min_sun_elev_deg: 15,
  }

  it('round-trips between the API shape and the settings the card edits', () => {
    const preset = fromSavedPreset(saved)
    expect(preset.id).toBe('user:7')
    expect(preset.settings).toEqual({
      mode: 'fov',
      swathKm: 30,
      fovDeg: 3.5,
      maxOffNadirDeg: 25,
      minSunElevDeg: 15,
    })
    expect({ id: 7, ...toSavedPresetInput('My EO', preset.settings) }).toEqual(saved)
  })

  it('matches a saved preset after the built-in ones', () => {
    const preset = fromSavedPreset(saved)
    expect(matchingPreset(preset.settings, [preset])).toBe('user:7')
    expect(matchingPreset(sensorPresets[0].settings, [preset])).toBe('hr-eo')
  })
})
