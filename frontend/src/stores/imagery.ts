import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { api } from '../api/client'
import { apiErrorText } from '../api/messages'
import type {
  ImageryInbox,
  ImagerySamples,
  ImagerySensor,
  ImagerySet,
  ImageryUpload,
} from '../api/types'
import { translate } from '../i18n'
import {
  filterImagery,
  imageryFileProblem,
  imageryViewPoint,
  NO_IMAGERY_FILTER,
  type BatchEntry,
  type ImageryFilter,
} from '../utils/imagery'
import { useLayersStore } from './layers'
import { usePlacesStore } from './places'

const POLL_MS = 1500
/** A batch waits while this many imports are in flight, so scratch files do not pile up. */
const BATCH_IN_FLIGHT = 3

/**
 * User imagery: the sets kept under `data/imagery`, and the read-only samples beside them.
 * A set is drawn when the camera zooms in on it; the globe layer reports which ones are.
 */
export const useImageryStore = defineStore('imagery', () => {
  const layers = useLayersStore()
  const places = usePlacesStore()
  const items = shallowRef<ImagerySet[]>([])
  const loadError = ref('')
  /** Narrows the list by sensor and resolution. Kept while the page lives, not across reloads. */
  const filter = ref<ImageryFilter>({ ...NO_IMAGERY_FILTER })
  const shown = computed(() => filterImagery(items.value, filter.value))
  /** The watched folder and what is waiting in it; null until first loaded. */
  const inbox = shallowRef<ImageryInbox | null>(null)
  /** Whether the samples submodule is there; null until first loaded. */
  const samples = shallowRef<ImagerySamples | null>(null)
  /** Ids of the sets on the globe right now, written by the imagery layer. */
  const active = shallowRef<ReadonlySet<string>>(new Set())
  /** Imports started from this page; the camera goes to each as soon as it is ready. */
  const awaited = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function setActive(ids: readonly string[]) {
    active.value = new Set(ids)
  }

  /** Move the camera to a set, close enough for it to appear. */
  function flyTo(item: ImagerySet) {
    const point = imageryViewPoint(item)
    if (point) places.flyToPoint(point)
  }

  function accept(list: ImagerySet[]) {
    items.value = list
    for (const item of list) {
      if (!awaited.has(item.id) || item.status === 'processing') continue
      awaited.delete(item.id)
      if (item.status === 'ready') flyTo(item)
    }
    clearTimeout(timer)
    // Keep looking while something is being imported or is waiting in the inbox.
    if (list.some((item) => item.status === 'processing') || inbox.value?.waiting.length) {
      timer = setTimeout(() => void load(), POLL_MS)
    }
  }

  async function load() {
    try {
      const [list, folder, sampleState] = await Promise.all([
        api.imagery(),
        api.imageryInbox(),
        api.imagerySamples(),
      ])
      loadError.value = ''
      inbox.value = folder
      samples.value = sampleState
      accept(list)
      // Only after a list that loaded: a failed request must not forget every choice.
      layers.pruneImagery(list.map((item) => item.id))
    } catch (error) {
      loadError.value = apiErrorText(error, translate)
    }
  }

  /**
   * Upload a file; throws with a user-facing message. An import that takes a while is polled.
   *
   * @param follow Go to the set once it is ready. Off for a batch, which would otherwise send
   *   the camera to every file in turn.
   */
  async function upload(upload: ImageryUpload, file: File, follow = true) {
    const problem = imageryFileProblem(upload.source_format, file)
    if (problem) throw new Error(problem)
    let created: ImagerySet
    try {
      created = await api.uploadImagery(upload, file)
    } catch (error) {
      throw new Error(apiErrorText(error, translate), { cause: error })
    }
    if (follow) awaited.add(created.id)
    accept([created, ...items.value.filter((item) => item.id !== created.id)])
  }

  function processing(): number {
    return items.value.filter((item) => item.status === 'processing').length
  }

  /**
   * Upload the usable files of a batch one after another.
   *
   * @param report Called after each file with its index and an error message, empty on success.
   */
  async function uploadMany(
    entries: readonly BatchEntry[],
    shared: { attribution: string; license: string; sensor: ImagerySensor | null },
    report: (index: number, error: string) => void,
  ) {
    for (const [index, entry] of entries.entries()) {
      if (entry.problem || !entry.format) continue
      while (processing() >= BATCH_IN_FLIGHT) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
      try {
        await upload(
          {
            source_format: entry.format,
            name: entry.name,
            attribution: shared.attribution,
            license: shared.license,
            acquired_at: '',
            corners_deg: null,
            sensor: shared.sensor,
          },
          entry.file,
          false,
        )
        report(index, '')
      } catch (error) {
        report(index, error instanceof Error ? error.message : String(error))
      }
    }
  }

  async function update(
    id: string,
    body: {
      name: string
      attribution: string
      license: string
      acquired_at: string | null
      sensor: ImagerySensor | ''
    },
  ) {
    let updated: ImagerySet
    try {
      updated = await api.updateImagery(id, body)
    } catch (error) {
      throw new Error(apiErrorText(error, translate), { cause: error })
    }
    items.value = items.value.map((item) => (item.id === id ? updated : item))
  }

  /** Delete a set, cancel its import, or clear a failed one. */
  async function remove(id: string) {
    try {
      await api.deleteImagery(id)
    } catch (error) {
      throw new Error(apiErrorText(error, translate), { cause: error })
    }
    awaited.delete(id)
    await load()
  }

  onScopeDispose(() => clearTimeout(timer))

  return {
    items,
    filter,
    shown,
    loadError,
    inbox,
    samples,
    active,
    setActive,
    load,
    upload,
    uploadMany,
    update,
    remove,
    flyTo,
  }
})
