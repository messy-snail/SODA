import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'
import { api, ApiError } from '../api/client'
import type { DatabasePage, DatabaseTable, UserDataImportResult } from '../api/types'

/** The settings dialog's table browser and the user-data import. Read-only apart from import. */
export const useDatabaseStore = defineStore('database', () => {
  const tables = ref<DatabaseTable[]>([])
  const table = ref('stations')
  const query = ref('')
  const page = shallowRef<DatabasePage | null>(null)
  const loading = ref(false)
  const error = ref<unknown>(null)
  const importing = ref(false)
  const importResult = ref<UserDataImportResult | null>(null)
  const importError = ref<unknown>(null)
  let controller: AbortController | null = null

  async function loadTables() {
    try {
      tables.value = await api.databaseTables()
    } catch (caught) {
      error.value = caught
    }
  }

  async function loadPage(offset: number, limit: number) {
    controller?.abort()
    const current = (controller = new AbortController())
    loading.value = true
    error.value = null
    try {
      const result = await api.databasePage(table.value, offset, limit, query.value, current.signal)
      page.value = markRaw(result)
    } catch (caught) {
      if (current.signal.aborted) return
      error.value = caught
      page.value = null
    } finally {
      if (controller === current) loading.value = false
    }
  }

  /** Read an exported JSON file and add what it holds; clashing names are skipped. */
  async function importFile(file: File) {
    importing.value = true
    importResult.value = null
    importError.value = null
    try {
      let data: unknown
      try {
        data = JSON.parse(await file.text())
      } catch {
        throw new ApiError('invalid JSON', 422, 'invalidRequest', { fields: [] })
      }
      importResult.value = await api.importUserData(data)
      await loadTables()
    } catch (caught) {
      importError.value = caught
    } finally {
      importing.value = false
    }
  }

  return {
    tables,
    table,
    query,
    page,
    loading,
    error,
    importing,
    importResult,
    importError,
    loadTables,
    loadPage,
    importFile,
  }
})
