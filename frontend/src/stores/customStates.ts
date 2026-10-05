import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import type { CatalogDetail, CustomStateInput, CustomStateSummary } from '../api/types'

/** State vectors the user typed in or imported as an OPM, kept in the database. */
export const useCustomStatesStore = defineStore('customStates', () => {
  const list = ref<CustomStateSummary[]>([])
  const error = ref<unknown>(null)

  async function load() {
    try {
      list.value = await api.customStates()
      error.value = null
    } catch (caught) {
      error.value = caught
    }
  }

  /** Saves a typed-in state; the server converts it to GCRS and rejects what it cannot use. */
  async function add(input: CustomStateInput): Promise<CatalogDetail> {
    const created = await api.createCustomState(input)
    await load()
    return created
  }

  /** Saves the state vector of an OPM file. */
  async function importFile(file: Blob): Promise<CatalogDetail> {
    const created = await api.importCustomState(file)
    await load()
    return created
  }

  async function remove(id: number) {
    await api.deleteCustomState(id)
    await load()
  }

  return { list, error, load, add, importFile, remove }
})
