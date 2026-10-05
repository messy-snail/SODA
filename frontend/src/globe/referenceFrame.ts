import { Cartesian3, JulianDate, Matrix3, SceneMode, Transforms, type Viewer } from 'cesium'
import { watch } from 'vue'
import { useClockStore } from '../stores/clock'
import { useLayersStore } from '../stores/layers'
import { useRunsStore } from '../stores/runs'
import { preloadInertialFrame, resetInertialFrameCache } from './useViewer'

/**
 * Switch the camera frame independently of the Earth-relative path.
 *
 * The inertial view keeps the camera pose fixed in ICRF by rotating it each frame with the
 * Earth's rotation since the previous frame. The camera transform stays the identity: a
 * `lookAtTransform` would make Cesium's camera controller drop the globe, and with it the
 * surface collision that stops zooming through the Earth.
 */
export function useReferenceFrame(viewer: Viewer) {
  const layers = useLayersStore()
  const clock = useClockStore()
  const runs = useRunsStore()
  let generation = 0
  let disposed = false
  /** Whether `previous` holds the ICRF-to-fixed rotation of the last inertial frame. */
  let attached = false
  const rotation = new Matrix3()
  const previous = new Matrix3()
  const inverse = new Matrix3()
  const delta = new Matrix3()

  function release() {
    attached = false
  }

  function fail() {
    layers.frameState.ready = false
    layers.frameState.failed = true
    layers.prefs.frame = 'fixed'
    release()
  }

  async function prepare() {
    const request = ++generation
    layers.frameState.ready = false
    release()
    if (layers.prefs.frame !== 'inertial') {
      layers.frameState.loading = false
      return
    }
    layers.frameState.loading = true
    // Reset at the explicit retry, not at failure: background scene transforms can retry
    // while the network is still unavailable and poison a freshly reset cache again.
    if (layers.frameState.failed) resetInertialFrameCache()
    layers.frameState.failed = false
    const now = JulianDate.toDate(viewer.clock.currentTime).getTime()
    const start = Math.min(now - 43_200_000, clock.startMs, ...runs.runs.map((run) => run.startMs))
    const stop = Math.max(now + 43_200_000, clock.stopMs, ...runs.runs.map((run) => run.stopMs))
    try {
      await preloadInertialFrame(start, stop)
      if (disposed || request !== generation) return
      if (!Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime, rotation)) {
        throw new Error('Inertial transform unavailable')
      }
      layers.frameState.ready = true
    } catch {
      if (!disposed && request === generation) {
        fail()
      }
    } finally {
      if (!disposed && request === generation) layers.frameState.loading = false
    }
  }

  const stopWatch = watch(
    () => [
      layers.prefs.frame,
      clock.bounded,
      clock.bounded ? clock.startMs : null,
      clock.bounded ? clock.stopMs : null,
      runs.runs.map((run) => run.id).join(','),
    ],
    () => void prepare(),
    { immediate: true },
  )
  const remove = viewer.scene.postUpdate.addEventListener(() => {
    // A tracked entity owns the camera, and a morph or the 2D map has no inertial view.
    if (
      viewer.trackedEntity ||
      viewer.scene.mode !== SceneMode.SCENE3D ||
      layers.effectiveFrame !== 'inertial'
    ) {
      release()
      return
    }
    const matrix = Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime, rotation)
    if (!matrix) {
      void prepare()
      return
    }
    if (!attached) {
      Matrix3.clone(matrix, previous)
      attached = true
      return
    }
    // p_fixed(t) = R(t)·R(t_prev)ᵀ·p_fixed(t_prev) keeps the pose constant in ICRF.
    Matrix3.multiply(matrix, Matrix3.transpose(previous, inverse), delta)
    Matrix3.clone(matrix, previous)
    if (Matrix3.equalsEpsilon(delta, Matrix3.IDENTITY, 1e-15)) return
    const camera = viewer.camera
    Matrix3.multiplyByVector(delta, camera.position, camera.position)
    Matrix3.multiplyByVector(delta, camera.direction, camera.direction)
    Matrix3.multiplyByVector(delta, camera.up, camera.up)
    Cartesian3.normalize(camera.direction, camera.direction)
    Cartesian3.normalize(camera.up, camera.up)
    Cartesian3.cross(camera.direction, camera.up, camera.right)
    Cartesian3.normalize(camera.right, camera.right)
  })

  return {
    dispose() {
      disposed = true
      generation++
      stopWatch()
      remove()
      release()
      layers.frameState.ready = false
      layers.frameState.loading = false
    },
  }
}
