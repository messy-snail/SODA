import { Cartesian3, Math as CesiumMath, Rectangle, type Viewer } from 'cesium'
import { watch } from 'vue'
import { paddedBbox, type CameraPoint } from '../places/camera'
import type { CameraSnapshot } from '../stores/sessionSnapshot'
import { usePlacesStore } from '../stores/places'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { flyHome } from './useViewer'

const MORPH_S = 1
const FLY_S = 1.5

/**
 * Applies camera requests from the UI to the globe: the home view, the 2D/3D switch,
 * flights to searched places and pins, and captures of the current view.
 */
export function useViewControl(viewer: Viewer) {
  const ui = useUiStore()
  const runs = useRunsStore()
  const places = usePlacesStore()
  const { scene, camera } = viewer

  /** A tracked entity owns the camera, so release it before moving the camera ourselves. */
  function stopTracking() {
    runs.track(null)
    viewer.trackedEntity = undefined
  }

  /** The camera position as a longitude, latitude and height; valid in 2D and 3D alike. */
  function currentPoint(): CameraPoint {
    const carto = camera.positionCartographic
    return {
      lon_deg: CesiumMath.toDegrees(carto.longitude),
      lat_deg: CesiumMath.toDegrees(carto.latitude),
      height_m: carto.height,
    }
  }

  /** A restored view waits here while a 2D morph runs, then replaces the home jump. */
  let pendingView: CameraSnapshot | null = null

  function applyView(view: CameraSnapshot) {
    camera.setView({
      destination: Cartesian3.fromDegrees(view.lon_deg, view.lat_deg, view.height_m),
      orientation: { heading: view.heading_rad, pitch: view.pitch_rad, roll: view.roll_rad },
    })
  }

  const removeMorph = scene.morphComplete.addEventListener(() => {
    if (pendingView) applyView(pendingView)
    else flyHome(viewer, places.saved.home, 0)
    pendingView = null
  })

  watch(
    () => ui.homeRequest,
    () => {
      stopTracking()
      flyHome(viewer, places.saved.home)
    },
  )
  watch(
    () => ui.sceneMode,
    (mode) => {
      stopTracking()
      if (mode === '2d') scene.morphTo2D(MORPH_S)
      else scene.morphTo3D(MORPH_S)
    },
  )
  watch(
    () => places.flyRequest,
    (request) => {
      if (!request) return
      stopTracking()
      if (request.kind === 'point') {
        const { lon_deg, lat_deg, height_m } = request.point
        camera.flyTo({
          destination: Cartesian3.fromDegrees(lon_deg, lat_deg, height_m),
          duration: FLY_S,
        })
      } else {
        const [west, south, east, north] = paddedBbox(request.bbox)
        camera.flyTo({
          destination: Rectangle.fromDegrees(west, south, east, north),
          duration: FLY_S,
        })
      }
    },
  )
  watch(
    () => places.captureRequest,
    (request) => {
      if (request) places.receiveCapture(request, currentPoint())
    },
  )

  /** The camera as a snapshot, for the session store. */
  function snapshot(): CameraSnapshot {
    return {
      ...currentPoint(),
      heading_rad: camera.heading,
      pitch_rad: camera.pitch,
      roll_rad: camera.roll,
    }
  }

  /** Put the camera back where a previous page load left it, in its scene mode. */
  function restore(view: CameraSnapshot, mode: '3d' | '2d') {
    if (mode === '2d' && ui.sceneMode !== '2d') {
      pendingView = view
      ui.sceneMode = '2d'
    } else {
      applyView(view)
    }
  }

  return {
    snapshot,
    restore,
    dispose() {
      removeMorph()
    },
  }
}
