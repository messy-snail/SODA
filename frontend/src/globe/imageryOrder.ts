import type { ImageryLayer, Viewer } from 'cesium'

/**
 * Stacking order of the imagery overlays, bottom to top. The basemap is band 0 and never
 * registers here. Layers must not know about each other, so each one names its band and this
 * module finds the index: user imagery sits right above the basemap, below the country tint,
 * the coverage map and the station visibility areas, and the night and eclipse shading of
 * the 2D map covers them all. The coverage map is above the tint so that a tinted country
 * does not shift the colours its legend explains.
 */
export const IMAGERY_BAND = { user: 1, tint: 2, coverage: 3, visibility: 4, shade: 5 } as const

const bands = new WeakMap<ImageryLayer, number>()

/** Index for a new layer: above every layer of the same or a lower band. */
export function insertIndex(existing: readonly number[], band: number): number {
  let index = 0
  existing.forEach((value, position) => {
    if (value <= band) index = position + 1
  })
  return index
}

/** Add an imagery layer at the place its band belongs. */
export function addOrdered(viewer: Viewer, layer: ImageryLayer, band: number): ImageryLayer {
  const layers = viewer.imageryLayers
  const existing = Array.from({ length: layers.length }, (_, i) => bands.get(layers.get(i)) ?? 0)
  bands.set(layer, band)
  layers.add(layer, insertIndex(existing, band))
  return layer
}
