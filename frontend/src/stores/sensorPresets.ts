import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import {
  fromSavedPreset,
  toSavedPresetInput,
  type SensorSettings,
  type UserSensorPreset,
} from '../sensors/presets'

/** Sensor setups the user saved by name, kept in the database like ground stations. */
export const useSensorPresetsStore = defineStore('sensorPresets', () => {
  const list = ref<UserSensorPreset[]>([])
  const error = ref<unknown>(null)
  let loaded: Promise<void> | null = null

  async function reload() {
    try {
      list.value = (await api.sensorPresets()).map(fromSavedPreset)
      error.value = null
    } catch (caught) {
      error.value = caught
    }
  }

  /** Loads once; later calls reuse the first request. */
  function load(): Promise<void> {
    loaded ??= reload()
    return loaded
  }

  /** Saves a new preset; a name clash rejects with the API's `sensorPresetNameTaken`. */
  async function save(name: string, settings: SensorSettings): Promise<UserSensorPreset> {
    const created = await api.createSensorPreset(toSavedPresetInput(name, settings))
    await reload()
    return fromSavedPreset(created)
  }

  async function overwrite(
    preset: UserSensorPreset,
    settings: SensorSettings,
  ): Promise<UserSensorPreset> {
    const updated = await api.updateSensorPreset(
      preset.dbId,
      toSavedPresetInput(preset.name, settings),
    )
    await reload()
    return fromSavedPreset(updated)
  }

  async function remove(preset: UserSensorPreset) {
    await api.deleteSensorPreset(preset.dbId)
    await reload()
  }

  return { list, error, load, save, overwrite, remove }
})
