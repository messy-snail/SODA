import type { ModelInfo } from '../api/types'
import { translate } from '../i18n'
import { DEFAULT_NAME, resolveNamed, sortNamed } from './namedFiles'

export { formatBytes } from './namedFiles'

/** Mirrors `MAX_MODEL_BYTES` in `src/soda/models3d.py`. */
export const MAX_MODEL_BYTES = 64 * 1024 * 1024
export const DEFAULT_MODEL = DEFAULT_NAME

/** The satellite's own model, else the shared default, else none. */
export function resolveModel(models: readonly ModelInfo[], noradId: number): ModelInfo | null {
  return resolveNamed(models, noradId)
}

/** Default first, then by NORAD number, matching the API order. */
export function sortModels(models: readonly ModelInfo[]): ModelInfo[] {
  return sortNamed(models)
}

/** A user-facing reason the file cannot be uploaded, or an empty string. */
export function modelFileProblem(fileName: string, sizeBytes: number): string {
  if (!fileName.toLowerCase().endsWith('.glb')) {
    return translate('uploads.modelType')
  }
  if (sizeBytes > MAX_MODEL_BYTES) {
    return translate('uploads.modelTooLarge', { max: MAX_MODEL_BYTES / (1024 * 1024) })
  }
  return ''
}
