import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Entity,
  Math as CesiumMath,
  Matrix4,
  SceneMode,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from 'cesium'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useClockStore } from '../stores/clock'
import { useCoverageStore } from '../stores/coverage'
import { useMissionStore } from '../stores/mission'
import { passKey, usePassesStore } from '../stores/passes'
import { usePlacesStore } from '../stores/places'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { jumpTarget } from '../utils/passTimeline'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import { hiddenByEllipsoid, nearestOnPolyline } from './geometry'
import type { useOrbitLayer, OrbitPickId } from './orbitLayer'

/** How deep to look for something interactive behind the comparison path or sensor fan. */
const PICK_DEPTH = 4

function isOrbitPick(id: unknown): id is OrbitPickId {
  return typeof id === 'object' && id !== null && (id as OrbitPickId).kind === 'orbit'
}

/** Decorative overlays that are drawn on top but must not swallow clicks. */
function isReferencePick(id: unknown): boolean {
  if (id instanceof Entity) return id.id.startsWith('sensor-fan') || id.id === 'pin-draft'
  const kind = typeof id === 'object' && id !== null ? (id as { kind?: unknown }).kind : null
  return kind === 'inertial-reference' || kind === 'country-label'
}

/** Click and hover handling: orbit lines, run markers, catalog points, stations, pins. */
export function usePicking(viewer: Viewer, orbit: ReturnType<typeof useOrbitLayer>) {
  const runs = useRunsStore()
  const clock = useClockStore()
  const basket = useSatelliteBasketStore()
  const passes = usePassesStore()
  const ui = useUiStore()
  const places = usePlacesStore()
  const mission = useMissionStore()
  const coverage = useCoverageStore()
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  const scratch = new Cartesian3()
  const windowPosition = new Cartesian2()

  /**
   * The inertial comparison path is drawn over the orbit lines and is not interactive, but it is
   * still pickable geometry. Drill past it so a click lands on whatever it covers.
   */
  function pickPastReference(position: Cartesian2): unknown {
    const picked = viewer.scene.drillPick(position, PICK_DEPTH, 10, 10)
    for (const hit of picked) {
      if (!isReferencePick(hit?.id)) return hit?.id
    }
    return undefined
  }

  /**
   * Time at the point of the orbit line under the click, read between the two samples around
   * it, so the marker lands where the click was. Vertices behind the globe are left out: they
   * project inside its disc too, and would send the clock to the far side.
   */
  function clickedTime(id: OrbitPickId, click: Cartesian2): number | null {
    const entry = orbit.graphics.get(id.runId)
    if (!entry) return null
    const segment = entry.trail.segments[id.segmentIndex]
    if (!segment) return null
    const model = entry.lines.modelMatrix
    // On the flat map nothing is behind anything.
    const globe = viewer.scene.mode === SceneMode.SCENE3D
    const camera = viewer.camera.positionWC
    const radii = viewer.scene.globe.ellipsoid.radii
    const xs = new Float64Array(segment.positions.length)
    const ys = new Float64Array(segment.positions.length)
    for (let i = 0; i < segment.positions.length; i++) {
      Cartesian3.clone(segment.positions[i]!, scratch)
      Matrix4.multiplyByPoint(model, scratch, scratch)
      const projected =
        globe && hiddenByEllipsoid(camera, scratch, radii)
          ? undefined
          : SceneTransforms.worldToWindowCoordinates(viewer.scene, scratch, windowPosition)
      xs[i] = projected ? projected.x : Number.NaN
      ys[i] = projected ? projected.y : Number.NaN
    }
    const hit = nearestOnPolyline(xs, ys, click.x, click.y)
    if (!hit) return null
    const from = segment.timesMs[hit.index]!
    const to = segment.timesMs[hit.index + 1] ?? from
    return from + (to - from) * hit.fraction
  }

  /** Longitude and latitude under a screen point, or null off the globe. */
  function groundPoint(position: Cartesian2): { lon_deg: number; lat_deg: number } | null {
    const hit = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
    if (!hit) return null
    const carto = Cartographic.fromCartesian(hit)
    return {
      lon_deg: CesiumMath.toDegrees(carto.longitude),
      lat_deg: CesiumMath.toDegrees(carto.latitude),
    }
  }

  handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
    // Placing a pin takes the click before anything on the globe can pick it.
    if (places.placing) {
      const point = groundPoint(event.position)
      if (point) places.receiveClick(point.lon_deg, point.lat_deg)
      return
    }
    if (mission.placing) {
      const point = groundPoint(event.position)
      if (point) mission.receiveClick(point.lon_deg, point.lat_deg)
      return
    }
    const id = pickPastReference(event.position)
    if (isOrbitPick(id)) {
      runs.select(id.runId)
      const time = clickedTime(id, event.position)
      if (time !== null) clock.seek(time)
      return
    }
    if (id instanceof Entity && id.id.startsWith('marker:')) {
      runs.select(id.id.slice('marker:'.length))
      return
    }
    if (id instanceof Entity && id.id.startsWith('station:')) {
      // Clicking toggles, which is how several stations get compared on one timeline.
      passes.toggleStation(Number(id.id.slice('station:'.length)))
      ui.openTool('passes')
      return
    }
    if (id instanceof Entity && id.id.startsWith('pass:')) {
      const key = id.id.slice('pass:'.length)
      const entry = passes.timeline.find((item) => passKey(item.pass) === key)
      if (entry) revealWithinRuns(clock, runs.runs, jumpTarget(entry.pass, ui.contactJump))
      return
    }
    if (id instanceof Entity && id.id.startsWith('pass-end:')) {
      // ``pass-end:<pass id>:<aos|los>``; the pass id itself holds colons.
      const rest = id.id.slice('pass-end:'.length)
      const end = rest.slice(rest.lastIndexOf(':') + 1)
      const key = rest.slice(0, rest.lastIndexOf(':'))
      const entry = passes.timeline.find((item) => passKey(item.pass) === key)
      if (entry) {
        revealWithinRuns(
          clock,
          runs.runs,
          Date.parse(end === 'los' ? entry.pass.los : entry.pass.aos),
        )
      }
      return
    }
    if (id instanceof Entity && id.id.startsWith('access:')) {
      // ``access:<shot key>``; looked up rather than parsed, since the key holds colons.
      const shot = mission.shotIndex.get(id.id.slice('access:'.length))
      if (shot) revealWithinRuns(clock, runs.runs, shot.bestMs)
      ui.openImagingTab('results')
      return
    }
    // A cell of the coverage map: imagery cannot be picked, so the click is placed on the
    // grid by its longitude and latitude. Satellite dots above the map keep their click.
    if (coverage.shown && typeof id !== 'number') {
      const point = groundPoint(event.position)
      if (point && coverage.selectAt(point.lon_deg, point.lat_deg)) {
        ui.openTool('coverage')
        return
      }
    }
    if (id instanceof Entity && id.id.startsWith('aoi:')) {
      mission.focusedTargetId = id.id.slice('aoi:'.length)
      ui.openImagingTab('targets')
      return
    }
    if (id instanceof Entity && /^pin(-far)?:/.test(id.id)) {
      places.focusPin(id.id.slice(id.id.indexOf(':') + 1))
      ui.openTool('view', 'places')
      return
    }
    if (typeof id === 'number') {
      basket.add({ noradId: id, customId: null })
      ui.openSatelliteStep('pick')
    }
  }, ScreenSpaceEventType.LEFT_CLICK)

  let pending: Cartesian2 | null = null
  let frame = 0
  handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
    pending = Cartesian2.clone(event.endPosition, pending ?? undefined)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!pending || viewer.isDestroyed()) return
      if (places.placing || mission.placing) {
        viewer.scene.canvas.style.cursor = 'crosshair'
        return
      }
      const id = pickPastReference(pending)
      const runId = isOrbitPick(id) ? id.runId : null
      if (runs.hoveredRunId !== runId) runs.hoveredRunId = runId
      const clickable = runId || id instanceof Entity || typeof id === 'number'
      viewer.scene.canvas.style.cursor = clickable ? 'pointer' : ''
    })
  }, ScreenSpaceEventType.MOUSE_MOVE)

  return {
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      handler.destroy()
    },
  }
}
