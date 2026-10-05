import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { api, ApiError } from '../api/client'
import type { LogoInfo } from '../api/types'
import { rasterizeLogo } from '../utils/logoImage'
import { LOGO_UPLOAD_PX, logoFileProblem } from '../utils/logos'
import { resolveNamed, sortNamed } from '../utils/namedFiles'
import { operatorKey } from '../utils/operators'

/** Organization logos: uploads under `data/logos`, over the ones bundled with the backend. */
export const useLogosStore = defineStore('logos', () => {
  const items = shallowRef<LogoInfo[]>([])
  const loadError = ref('')

  async function load() {
    try {
      items.value = await api.logos()
      loadError.value = ''
    } catch (error) {
      loadError.value = error instanceof ApiError ? error.message : String(error)
    }
  }

  function put(info: LogoInfo) {
    items.value = sortNamed([...items.value.filter((l) => l.name !== info.name), info])
  }

  /** Convert an image to a square PNG and upload it. Throws with a user-facing message. */
  async function upload(name: string, file: File) {
    const problem = logoFileProblem(file)
    if (problem) throw new Error(problem)
    const png = await rasterizeLogo(file, { size: LOGO_UPLOAD_PX })
    put(await api.uploadLogo(name, png))
  }

  /** Delete an upload. A bundled logo underneath it reappears, so reload instead of filtering. */
  async function remove(name: string) {
    await api.deleteLogo(name)
    await load()
  }

  function find(name: string) {
    return items.value.find((l) => l.name === name) ?? null
  }

  /** The satellite's own logo, else its operator's, else the shared default. */
  function logoFor(noradId: number, name?: string) {
    return resolveNamed(items.value, noradId, name ? operatorKey(name, noradId) : null)
  }

  return { items, loadError, load, upload, remove, find, logoFor }
})
