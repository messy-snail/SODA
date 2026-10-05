import {
  Cartesian2,
  Cartographic,
  EllipsoidGeodesic,
  Math as CesiumMath,
  SceneMode,
  type Viewer,
} from 'cesium'
import { useUiStore } from '../stores/ui'
import { pickScaleBar, viewBounds } from './scaleBar'

/** Recompute at most this often; a scale that lags a tenth of a second reads as live. */
const INTERVAL_MS = 100
/** Points along each side of the grid dropped onto the globe to find what the view covers. */
const GRID = 5
/** Half the distance, in pixels, between the two points the resolution is measured from. */
const HALF_SPAN_PX = 50

/**
 * What the camera currently shows, for the parts of the UI that are not on the globe.
 *
 * The map scale is measured across the middle of the canvas: two points a fixed number of
 * pixels apart are dropped onto the ellipsoid and the ground distance between them gives
 * metres per pixel. The middle is used because the lower edge looks into space from the
 * default whole-Earth view. The same code works in 3D and on the 2D map; while a point misses
 * the globe, or the scene is morphing, there is no scale to show.
 *
 * The area in view is found the same way, from a grid of points over the whole canvas. It is
 * only reported when every one of them lands on the globe, which is when a catalogue search
 * for "this view" means something.
 */
export function useViewMetrics(viewer: Viewer) {
  const ui = useUiStore()
  const left = new Cartesian2()
  const right = new Cartesian2()
  const geodesic = new EllipsoidGeodesic()
  let last = 0

  function metresPerPixel(): number | null {
    const { scene, camera } = viewer
    if (scene.mode === SceneMode.MORPHING) return null
    const { clientWidth, clientHeight } = scene.canvas
    left.x = clientWidth / 2 - HALF_SPAN_PX
    right.x = clientWidth / 2 + HALF_SPAN_PX
    left.y = right.y = clientHeight / 2
    const ellipsoid = scene.globe.ellipsoid
    const a = camera.pickEllipsoid(left, ellipsoid)
    const b = camera.pickEllipsoid(right, ellipsoid)
    if (!a || !b) return null
    geodesic.setEndPoints(Cartographic.fromCartesian(a), Cartographic.fromCartesian(b))
    return geodesic.surfaceDistance / (2 * HALF_SPAN_PX)
  }

  function bounds(): readonly [number, number, number, number] | null {
    const { scene, camera } = viewer
    if (scene.mode === SceneMode.MORPHING) return null
    const { clientWidth, clientHeight } = scene.canvas
    const points: [number, number][] = []
    const spot = new Cartesian2()
    for (let row = 0; row < GRID; row++) {
      for (let column = 0; column < GRID; column++) {
        spot.x = (clientWidth * column) / (GRID - 1)
        spot.y = (clientHeight * row) / (GRID - 1)
        const hit = camera.pickEllipsoid(spot, scene.globe.ellipsoid)
        if (!hit) return null
        const { longitude, latitude } = Cartographic.fromCartesian(hit)
        points.push([CesiumMath.toDegrees(longitude), CesiumMath.toDegrees(latitude)])
      }
    }
    return viewBounds(points)
  }

  const stop = viewer.scene.preRender.addEventListener(() => {
    const now = performance.now()
    if (now - last < INTERVAL_MS) return
    last = now
    const resolution = metresPerPixel()
    ui.setScaleBar(resolution === null ? null : pickScaleBar(resolution))
    ui.setViewBbox(bounds())
  })

  return {
    dispose() {
      stop()
      ui.setScaleBar(null)
      ui.setViewBbox(null)
    },
  }
}
