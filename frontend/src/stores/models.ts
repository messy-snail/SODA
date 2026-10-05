import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { api, ApiError } from '../api/client'
import type { ModelInfo, ModelSettings } from '../api/types'
import { modelFileProblem, resolveModel, sortModels } from '../utils/models'

/** 3D models stored by the backend under `data/models`. */
export const useModelsStore = defineStore('models', () => {
  const items = shallowRef<ModelInfo[]>([])
  const loadError = ref('')

  async function load() {
    try {
      items.value = await api.models()
      loadError.value = ''
    } catch (error) {
      loadError.value = error instanceof ApiError ? error.message : String(error)
    }
  }

  function put(info: ModelInfo) {
    items.value = sortModels([...items.value.filter((m) => m.name !== info.name), info])
  }

  /** Upload or replace a model. Throws with a user-facing message on failure. */
  async function upload(name: string, file: File) {
    const problem = modelFileProblem(file.name, file.size)
    if (problem) throw new Error(problem)
    put(await api.uploadModel(name, file))
  }

  async function saveSettings(name: string, settings: ModelSettings) {
    put(await api.saveModelSettings(name, settings))
  }

  async function remove(name: string) {
    await api.deleteModel(name)
    items.value = items.value.filter((m) => m.name !== name)
  }

  function find(name: string) {
    return items.value.find((m) => m.name === name) ?? null
  }

  function modelFor(noradId: number) {
    return resolveModel(items.value, noradId)
  }

  return { items, loadError, load, upload, saveSettings, remove, find, modelFor }
})
