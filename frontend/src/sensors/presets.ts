import type {
  SensorPreset as SavedSensorPreset,
  SensorPresetInput,
  SensorRequest,
} from '../api/types'
import type { Label } from '../i18n/label'
import { satKey, type SatelliteRef } from '../utils/satelliteRef'

export interface SensorSettings {
  mode: 'swath' | 'fov'
  swathKm: number
  fovDeg: number
  maxOffNadirDeg: number
  minSunElevDeg: number
}

export interface SensorPreset {
  id: string
  /** Lives with the table rather than in the message catalogue; see i18n/label.ts. */
  label: Label
  settings: SensorSettings
}

export const sensorPresets: SensorPreset[] = [
  {
    id: 'hr-eo',
    label: { ko: '고해상도 소형 EO', en: 'High-resolution small EO' },
    settings: { mode: 'swath', swathKm: 12, fovDeg: 1.4, maxOffNadirDeg: 30, minSunElevDeg: 10 },
  },
  {
    id: 'mr-eo',
    label: { ko: '중해상도 광역 EO', en: 'Medium-resolution wide EO' },
    settings: { mode: 'swath', swathKm: 120, fovDeg: 14, maxOffNadirDeg: 20, minSunElevDeg: 10 },
  },
  {
    id: 'wide',
    label: { ko: '광역 / 기상', en: 'Wide area / weather' },
    settings: { mode: 'swath', swathKm: 1500, fovDeg: 110, maxOffNadirDeg: 0, minSunElevDeg: 5 },
  },
]

const STORAGE_PREFIX = 'soda.sensor.'

/** Catalog satellites keep the old `soda.sensor.<norad>` key; pasted elements get their own. */
function sensorKey(ref: SatelliteRef): string {
  return `${STORAGE_PREFIX}${ref.customId != null ? satKey(ref) : ref.noradId}`
}

export function loadSensor(ref: SatelliteRef): SensorSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(sensorKey(ref)) ?? 'null')
    if (saved && typeof saved.swathKm === 'number')
      return { ...sensorPresets[0]!.settings, ...saved }
  } catch {
    /* Fall back to the default preset. */
  }
  return { ...sensorPresets[0]!.settings }
}

export function saveSensor(ref: SatelliteRef, settings: SensorSettings): void {
  try {
    localStorage.setItem(sensorKey(ref), JSON.stringify(settings))
  } catch {
    /* Session only. */
  }
}

export function toSensorRequest(settings: SensorSettings): SensorRequest {
  const width =
    settings.mode === 'swath' ? { swath_km: settings.swathKm } : { fov_deg: settings.fovDeg }
  return {
    ...width,
    max_off_nadir_deg: settings.maxOffNadirDeg,
    min_sun_elev_deg: settings.minSunElevDeg,
  }
}

/** A tile's one-line spec: width or FOV, then the steering limit when the sensor can steer. */
export function presetSummary(settings: SensorSettings): string {
  const width = settings.mode === 'swath' ? `${settings.swathKm} km` : `FOV ${settings.fovDeg}°`
  return settings.maxOffNadirDeg > 0 ? `${width} · ±${settings.maxOffNadirDeg}°` : width
}

/** A preset the user saved; `id` is `user:<db id>` so it never collides with a built-in one. */
export interface UserSensorPreset {
  id: string
  dbId: number
  name: string
  settings: SensorSettings
}

export function fromSavedPreset(saved: SavedSensorPreset): UserSensorPreset {
  return {
    id: `user:${saved.id}`,
    dbId: saved.id,
    name: saved.name,
    settings: {
      mode: saved.mode,
      swathKm: saved.swath_km,
      fovDeg: saved.fov_deg,
      maxOffNadirDeg: saved.max_off_nadir_deg,
      minSunElevDeg: saved.min_sun_elev_deg,
    },
  }
}

export function toSavedPresetInput(name: string, settings: SensorSettings): SensorPresetInput {
  return {
    name,
    mode: settings.mode,
    swath_km: settings.swathKm,
    fov_deg: settings.fovDeg,
    max_off_nadir_deg: settings.maxOffNadirDeg,
    min_sun_elev_deg: settings.minSunElevDeg,
  }
}

/** The built-in preset, then the saved one, whose values these are; null when none match. */
export function matchingPreset(
  settings: SensorSettings,
  saved: readonly UserSensorPreset[] = [],
): string | null {
  const same = (a: SensorSettings, b: SensorSettings) =>
    a.mode === b.mode &&
    (a.mode === 'swath' ? a.swathKm === b.swathKm : a.fovDeg === b.fovDeg) &&
    a.maxOffNadirDeg === b.maxOffNadirDeg &&
    a.minSunElevDeg === b.minSunElevDeg
  return [...sensorPresets, ...saved].find((preset) => same(preset.settings, settings))?.id ?? null
}
