import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { api } from '../api/client'
import { apiErrorText } from '../api/messages'
import type { ImageryCandidate, ImageryCatalogSource } from '../api/types'
import { translate } from '../i18n'
import { MAX_CATALOG_IMPORT_ITEMS, MAX_CATALOG_SEARCH_SPAN_DEG } from '../utils/imagery'
import { useImageryStore } from './imagery'
import { useUiStore } from './ui'

/**
 * Searching the public imagery catalogues for what the globe is showing, and importing picks.
 * The server makes every outside request; this store only talks to SODA.
 */
export const useImageryCatalogStore = defineStore('imageryCatalog', () => {
  const ui = useUiStore()
  const imagery = useImageryStore()
  const source = ref<ImageryCatalogSource>('maxar')
  const results = shallowRef<ImageryCandidate[]>([])
  /** Null until a search has run, so "nothing found" is told apart from "not searched". */
  const found = ref<number | null>(null)
  const truncated = ref(false)
  const loading = ref(false)
  const importing = ref(false)
  const error = ref('')
  const selected = ref<string[]>([])

  /** The view can be searched once the globe fills it and the box is small enough. */
  const searchable = computed(() => {
    const box = ui.viewBbox
    if (!box) return false
    return Math.max(box[2] - box[0], box[3] - box[1]) <= MAX_CATALOG_SEARCH_SPAN_DEG
  })

  /** Origins of the sets already here or on their way, to mark and skip them. */
  const imported = computed(
    () => new Set(imagery.items.map((item) => item.origin).filter(Boolean) as string[]),
  )

  function isImported(candidate: ImageryCandidate): boolean {
    return imported.value.has(`${candidate.source}:${candidate.item_id}`)
  }

  async function search() {
    const box = ui.viewBbox
    if (!box || !searchable.value || loading.value) return
    loading.value = true
    error.value = ''
    try {
      const body = await api.searchImageryCatalog(source.value, box)
      results.value = body.results
      found.value = body.found
      truncated.value = body.truncated
      selected.value = []
    } catch (caught) {
      error.value = apiErrorText(caught, translate)
    } finally {
      loading.value = false
    }
  }

  function toggle(itemId: string) {
    const at = selected.value.indexOf(itemId)
    if (at >= 0) selected.value.splice(at, 1)
    else if (selected.value.length < MAX_CATALOG_IMPORT_ITEMS) selected.value.push(itemId)
  }

  /** Tick or untick several results at once, as a date heading does; stops at the limit. */
  function setSelected(itemIds: readonly string[], on: boolean) {
    if (!on) {
      selected.value = selected.value.filter((id) => !itemIds.includes(id))
      return
    }
    for (const id of itemIds) {
      if (selected.value.length >= MAX_CATALOG_IMPORT_ITEMS) break
      if (!selected.value.includes(id)) selected.value.push(id)
    }
  }

  /** Ask the server to fetch items; the imagery list then shows them downloading. */
  async function importItems(from: ImageryCatalogSource, itemIds: string[]) {
    if (!itemIds.length || importing.value) return
    importing.value = true
    error.value = ''
    try {
      await api.importFromImageryCatalog(from, itemIds)
      selected.value = selected.value.filter((id) => !itemIds.includes(id))
      await imagery.load()
    } catch (caught) {
      error.value = apiErrorText(caught, translate)
    } finally {
      importing.value = false
    }
  }

  return {
    source,
    results,
    found,
    truncated,
    loading,
    importing,
    error,
    selected,
    searchable,
    isImported,
    search,
    toggle,
    setSelected,
    importItems,
  }
})
