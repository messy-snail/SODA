import { translate } from '../i18n'
import { containRect } from './logos'

export interface RasterizeOptions {
  /** Edge of the square output in pixels. */
  size: number
  /** Margin on every side as a fraction of the edge. */
  padding?: number
  /** CSS color painted under the logo; transparent when omitted. */
  background?: string
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(translate('uploads.imageUnreadable')))
    image.src = url
  }).finally(() => URL.revokeObjectURL(url))
}

/**
 * Draw an image (PNG, JPEG, WebP, or SVG) centered in a square PNG, keeping its aspect ratio.
 *
 * @throws Error with a user-facing message when the image cannot be decoded or encoded.
 */
export async function rasterizeLogo(blob: Blob, options: RasterizeOptions): Promise<Blob> {
  const image = await loadImage(blob)
  const { size, padding = 0, background } = options
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error(translate('uploads.imageConvertFailed'))
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, size, size)
  }
  const rect = containRect(image.naturalWidth, image.naturalHeight, size, padding)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error(translate('uploads.imageConvertFailed')))),
      'image/png',
    ),
  )
}
