import { logoUrl } from '../api/client'
import type { LogoInfo } from '../api/types'
import { rasterizeLogo } from '../utils/logoImage'
import type { MarkerShape } from '../utils/markerStyle'
import { buildGlb } from './glb'
import { cubeMesh, sphereMesh } from './shapeMesh'

export type SolidShape = Exclude<MarkerShape, 'point'>

const TEXTURE_PX = 512
/** Cube faces keep a border of background; the sphere's projection already leaves one. */
const TEXTURE_PADDING: Record<SolidShape, number> = { cube: 0.08, sphere: 0.02 }

async function logoTexture(logo: LogoInfo, shape: SolidShape, background: string) {
  const response = await fetch(logoUrl(logo))
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const png = await rasterizeLogo(await response.blob(), {
    size: TEXTURE_PX,
    padding: TEXTURE_PADDING[shape],
    background,
  })
  return new Uint8Array(await png.arrayBuffer())
}

async function build(shape: SolidShape, logo: LogoInfo | null, background: string) {
  let texture: Uint8Array | undefined
  if (logo) {
    try {
      texture = await logoTexture(logo, shape, background)
    } catch (error) {
      console.warn(`Drawing ${shape} without logo ${logo.name}:`, error)
    }
  }
  const mesh = shape === 'cube' ? cubeMesh() : sphereMesh()
  return URL.createObjectURL(new Blob([buildGlb(mesh, texture)], { type: 'model/gltf-binary' }))
}

/** Generated cube and sphere GLBs as blob URLs, shared by every run with the same look. */
export function createShapeCache() {
  const urls = new Map<string, Promise<string>>()

  function get(shape: SolidShape, logo: LogoInfo | null, background: string) {
    const key = ['shape', shape, logo?.name ?? '', logo?.updated_at ?? '', background].join('|')
    let url = urls.get(key)
    if (!url) {
      url = build(shape, logo, background)
      urls.set(key, url)
    }
    return { key, url }
  }

  /** Revoke the URLs of looks that no marker shows or waits for anymore. */
  function prune(keep: ReadonlySet<string>) {
    for (const [key, url] of urls) {
      if (keep.has(key)) continue
      urls.delete(key)
      void url.then(URL.revokeObjectURL)
    }
  }

  return { get, prune, dispose: () => prune(new Set()) }
}
