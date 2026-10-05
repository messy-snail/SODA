import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'
import type { DatabaseProbe, DatabaseStatus } from '../api/types'

/** The settings dialog: whether it is open, and the database it reports on. */
export const useSettingsStore = defineStore('settings', () => {
  const open = ref(false)
  const database = ref<DatabaseStatus | null>(null)
  const probe = ref<DatabaseProbe | null>(null)
  const busy = ref(false)
  const error = ref<unknown>(null)

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    busy.value = true
    error.value = null
    try {
      return await task()
    } catch (caught) {
      error.value = caught
      return null
    } finally {
      busy.value = false
    }
  }

  async function loadDatabase() {
    const status = await run(() => api.databaseStatus())
    if (status) database.value = status
  }

  async function testDatabase(url: string) {
    probe.value = await run(() => api.testDatabase(url))
  }

  /** Saves the URL for the next start; the dialog then shows the restart note. */
  async function saveDatabase(url: string) {
    const status = await run(() => api.saveDatabase(url))
    if (status) {
      database.value = status
      probe.value = null
    }
    return !!status
  }

  return { open, database, probe, busy, error, loadDatabase, testDatabase, saveDatabase }
})
