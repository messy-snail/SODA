import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import type { CatalogDetail, CustomElementSummary, ElementImportResult } from '../api/types'

/** Element sets the user pasted and saved, kept in the database. */
export const useCustomElementsStore = defineStore('customElements', () => {
  const list = ref<CustomElementSummary[]>([])
  const error = ref<unknown>(null)

  async function load() {
    try {
      list.value = await api.customElements()
      error.value = null
    } catch (caught) {
      error.value = caught
    }
  }

  /** Saves pasted TLE or OMM text; the server rejects what it cannot read. */
  async function add(name: string, text: string): Promise<CatalogDetail> {
    const created = await api.createCustomElement({ name, text })
    await load()
    return created
  }

  /** Saves every usable record of a TLE or OMM file; the result says what was left out. */
  async function importFile(file: Blob): Promise<ElementImportResult> {
    const result = await api.importCustomElements(file)
    await load()
    return result
  }

  async function remove(id: number) {
    await api.deleteCustomElement(id)
    await load()
  }

  return { list, error, load, add, importFile, remove }
})
