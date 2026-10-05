import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import type { CatalogDetail, CustomEphemerisSummary } from '../api/types'

/** Ephemerides the user imported as OEM files, kept in the database. */
export const useCustomEphemeridesStore = defineStore('customEphemerides', () => {
  const list = ref<CustomEphemerisSummary[]>([])
  const error = ref<unknown>(null)

  async function load() {
    try {
      list.value = await api.customEphemerides()
      error.value = null
    } catch (caught) {
      error.value = caught
    }
  }

  /** Stores an OEM file; a blank name keeps the file's own OBJECT_NAME. */
  async function importFile(file: Blob, name = ''): Promise<CatalogDetail> {
    const created = await api.importCustomEphemeris(file, name.trim())
    await load()
    return created
  }

  async function remove(id: number) {
    await api.deleteCustomEphemeris(id)
    await load()
  }

  return { list, error, load, importFile, remove }
})
