import {
  Credit,
  ImageryLayer,
  Math as CesiumMath,
  Rectangle,
  UrlTemplateImageryProvider,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { imageryTileUrl } from '../api/client'
import type { ImagerySet } from '../api/types'
import { useImageryStore } from '../stores/imagery'
import { useLayersStore } from '../stores/layers'
import { imageryCredit, imageryFade, minimumLevelFor } from '../utils/imagery'
import { addOrdered, IMAGERY_BAND } from './imageryOrder'

function createLayer(item: ImagerySet): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: imageryTileUrl(item),
    rectangle: Rectangle.fromDegrees(
      item.west_deg!,
      item.south_deg!,
      item.east_deg!,
      item.north_deg!,
    ),
    minimumLevel: minimumLevelFor(item),
    maximumLevel: item.max_zoom!,
    credit: imageryCredit(item) ? new Credit(imageryCredit(item)) : undefined,
    enablePickFeatures: false,
  })
  return new ImageryLayer(provider)
}

/**
 * The user's own imagery, drawn between the basemap and every other overlay.
 *
 * A set appears by zooming in on it: each frame `imageryFade` says how strongly every set
 * should show for the camera, and a set gets an imagery layer only while that is above zero.
 * Far from all of them the globe holds the basemap alone. Each layer is limited to its set's
 * rectangle, and a set that comes into view later lands above the ones already shown.
 */
export function useUserImageryLayer(viewer: Viewer) {
  const imagery = useImageryStore()
  const layers = useLayersStore()
  /** Shown layers by set id, with the version they were built from. */
  const shown = new Map<string, { layer: ImageryLayer; version: string }>()

  function remove(id: string) {
    const entry = shown.get(id)
    if (!entry) return
    if (viewer.imageryLayers.contains(entry.layer)) viewer.imageryLayers.remove(entry.layer)
    shown.delete(id)
  }

  function sync() {
    if (viewer.isDestroyed()) return
    const position = viewer.camera.positionCartographic
    const camera = {
      lon_deg: CesiumMath.toDegrees(position.longitude),
      lat_deg: CesiumMath.toDegrees(position.latitude),
      height_m: position.height,
    }
    const wanted = new Map<string, { item: ImagerySet; fade: number }>()
    if (layers.prefs.showUserImagery) {
      for (const item of imagery.items) {
        const fade = item.status === 'ready' ? imageryFade(item, camera) : 0
        if (fade > 0) wanted.set(item.id, { item, fade })
      }
    }
    let changed = false
    for (const [id, entry] of shown) {
      // A changed version means the tiles behind the URL changed, so the layer is rebuilt.
      if (wanted.get(id)?.item.updated_at !== entry.version) {
        remove(id)
        changed = true
      }
    }
    for (const [id, { item, fade }] of wanted) {
      let entry = shown.get(id)
      if (!entry) {
        entry = {
          layer: addOrdered(viewer, createLayer(item), IMAGERY_BAND.user),
          version: item.updated_at,
        }
        shown.set(id, entry)
        changed = true
      }
      entry.layer.alpha = layers.imageryPref(id).opacity * fade
    }
    if (changed) imagery.setActive([...shown.keys()])
  }

  // The camera has no change event fine enough for a fade, and this is a few comparisons.
  const stopRender = viewer.scene.preRender.addEventListener(sync)
  const stop = watch(
    () => [imagery.items, layers.prefs.imagery, layers.prefs.showUserImagery],
    () => {
      sync()
      if (!viewer.isDestroyed()) viewer.scene.requestRender()
    },
    { deep: true, immediate: true },
  )

  return {
    dispose() {
      stop()
      stopRender()
      for (const id of [...shown.keys()]) remove(id)
      imagery.setActive([])
    },
  }
}
