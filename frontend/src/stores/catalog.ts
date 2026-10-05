import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { api, ApiError } from '../api/client'
import type { StatusResponse } from '../api/types'

const STATUS_POLL_MS = 60_000

export const useCatalogStore = defineStore('catalog', () => {
  const status = shallowRef<StatusResponse | null>(null)
  const statusError = ref('')
  let pollTimer: ReturnType<typeof setInterval> | undefined

  /** The most relevant CelesTrak group fetch for the status chip. */
  const groupFetch = computed(() => {
    const fetches = status.value?.fetches.filter((f) => f.key.startsWith('group:')) ?? []
    return fetches.find((f) => f.key === 'group:active') ?? fetches[0] ?? null
  })

  async function loadStatus() {
    try {
      status.value = await api.status()
      statusError.value = ''
    } catch (error) {
      statusError.value = error instanceof ApiError ? error.message : String(error)
    }
  }

  function startPolling() {
    if (pollTimer) return
    void loadStatus()
    pollTimer = setInterval(loadStatus, STATUS_POLL_MS)
  }

  async function refreshGroup(group: string) {
    const result = await api.refreshGroup(group)
    await loadStatus()
    return result.result
  }

  return {
    status,
    statusError,
    groupFetch,
    loadStatus,
    startPolling,
    refreshGroup,
  }
})
