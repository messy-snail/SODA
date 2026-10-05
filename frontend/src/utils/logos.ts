import { translate } from '../i18n'

/** Largest image the browser accepts before rasterizing it to PNG. */
export const MAX_LOGO_INPUT_BYTES = 10 * 1024 * 1024
/** Edge of the square PNG uploaded to the server. */
export const LOGO_UPLOAD_PX = 512
export const LOGO_ACCEPT = '.png,.jpg,.jpeg,.webp,.svg'

const LOGO_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** A user-facing reason the image cannot be used as a logo, or an empty string. */
export function logoFileProblem(file: { name: string; type: string; size: number }): string {
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  const types = Object.values(LOGO_EXTENSIONS)
  if (!types.includes(file.type) && !(extension in LOGO_EXTENSIONS)) {
    return translate('uploads.logoType')
  }
  if (file.size > MAX_LOGO_INPUT_BYTES) {
    return translate('uploads.logoTooLarge', { max: MAX_LOGO_INPUT_BYTES / (1024 * 1024) })
  }
  return ''
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Largest rectangle with the image's aspect ratio centered in a square canvas.
 *
 * @param padding Margin on every side as a fraction of the canvas edge.
 */
export function containRect(width: number, height: number, size: number, padding = 0): Rect {
  const inner = size * (1 - 2 * padding)
  const scale = width > 0 && height > 0 ? inner / Math.max(width, height) : 0
  const w = scale ? width * scale : inner
  const h = scale ? height * scale : inner
  return { x: (size - w) / 2, y: (size - h) / 2, width: w, height: h }
}
