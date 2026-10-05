import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  Ellipsoid,
  JulianDate,
  PolygonHierarchy,
  type Entity,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { useRunsStore } from '../stores/runs'
import { useSelectionStore } from '../stores/selection'
import { useUiStore } from '../stores/ui'
import { useThemePreset } from '../theme/useThemePreset'
import { markerId } from './orbitLayer'
import { crossTrackEdges, type Vec3 } from './sensorFan'

const DEG = Math.PI / 180

interface FanSample {
  satellite: Cartesian3
  swath: [Cartesian3, Cartesian3]
  regard: [Cartesian3, Cartesian3] | null
}

/**
 * Pushbroom sensor footprint that follows the selected run's satellite.
 * A translucent triangle joins the satellite to both edges of the instantaneous nadir swath
 * line (cross-track, half-angle FOV/2); two faint rays mark the field-of-regard limits at
 * maximum roll. The geometry matches the backend swath edges (`orbit/swath.py`).
 */
export function useSensorFan(viewer: Viewer) {
  const runs = useRunsStore()
  const selection = useSelectionStore()
  const ui = useUiStore()
  const theme = useThemePreset()
  const scratchCarto = new Cartographic()
  const before = new JulianDate()
  const after = new JulianDate()
  const p0 = new Cartesian3()
  const p1 = new Cartesian3()
  let cachedTime: JulianDate | null = null
  let cached: FanSample | null = null

  const toCartesian = (v: Vec3) => new Cartesian3(v[0], v[1], v[2])

  function compute(time: JulianDate): FanSample | null {
    const run = runs.selectedRun
    const swath = selection.swath
    const applied = selection.appliedSensor
    const marker = run ? viewer.entities.getById(markerId(run.id)) : undefined
    if (!swath || !applied || !marker?.position || !marker.isAvailable(time)) return null
    const position = marker.position.getValue(time, new Cartesian3())
    if (!position) return null
    // Earth-fixed velocity by central difference, clamped to the sampled interval.
    JulianDate.addSeconds(time, -0.5, before)
    JulianDate.addSeconds(time, 0.5, after)
    const a = marker.isAvailable(before) ? marker.position.getValue(before, p0) : position
    const b = marker.isAvailable(after) ? marker.position.getValue(after, p1) : position
    if (!a || !b || Cartesian3.equals(a, b)) return null
    const velocity: Vec3 = [b.x - a.x, b.y - a.y, b.z - a.z]
    const carto = Cartographic.fromCartesian(position, Ellipsoid.WGS84, scratchCarto)
    if (!carto) return null
    const origin: Vec3 = [position.x, position.y, position.z]
    const edges = (angle: number): [Cartesian3, Cartesian3] => {
      const e = crossTrackEdges(origin, velocity, carto.latitude, carto.longitude, angle)
      return [toCartesian(e.left), toCartesian(e.right)]
    }
    const half = (swath.fov_deg / 2) * DEG
    const roll = applied.maxOffNadirDeg
    return {
      satellite: position,
      swath: edges(half),
      regard: swath.for_width_km != null && roll > 0 ? edges(roll * DEG + half) : null,
    }
  }

  function sample(time: JulianDate | undefined): FanSample | null {
    if (!time) return null
    if (!cachedTime || !JulianDate.equals(cachedTime, time)) {
      cachedTime = JulianDate.clone(time, cachedTime ?? undefined)
      cached = compute(time)
    }
    return cached
  }

  const fan: Entity = viewer.entities.add({
    id: 'sensor-fan',
    show: false,
    polygon: {
      hierarchy: new CallbackProperty((time) => {
        const s = sample(time)
        return s ? new PolygonHierarchy([s.satellite, s.swath[0], s.swath[1]]) : undefined
      }, false),
      perPositionHeight: true,
      arcType: ArcType.NONE,
      material: new ColorMaterialProperty(Color.CYAN.withAlpha(0.3)),
    },
  })

  const regard: Entity = viewer.entities.add({
    id: 'sensor-fan-regard',
    show: false,
    polyline: {
      positions: new CallbackProperty((time) => {
        const s = sample(time)
        return s?.regard ? [s.regard[0], s.satellite, s.regard[1]] : []
      }, false),
      arcType: ArcType.NONE,
      width: 1,
      material: new ColorMaterialProperty(Color.CYAN.withAlpha(0.45)),
    },
  })

  watch(
    () => [
      runs.selectedRun?.id,
      runs.selectedRun?.visible,
      selection.swath,
      selection.toggles.cone,
      selection.toggles.fieldOfRegard,
      theme.preset.id,
      ui.sceneMode,
    ],
    () => {
      cachedTime = null
      // The fan stands vertically above the ground track, so the flat map would collapse it.
      const shown = Boolean(
        runs.selectedRun?.visible &&
        selection.swath &&
        selection.toggles.cone &&
        ui.sceneMode === '3d',
      )
      fan.show = shown
      regard.show = shown && selection.toggles.fieldOfRegard
      const color = Color.fromCssColorString(theme.preset.globe.cone)
      if (fan.polygon) fan.polygon.material = new ColorMaterialProperty(color.withAlpha(0.35))
      if (regard.polyline)
        regard.polyline.material = new ColorMaterialProperty(color.withAlpha(0.5))
    },
    { immediate: true },
  )

  return {
    dispose() {
      viewer.entities.remove(fan)
      viewer.entities.remove(regard)
    },
  }
}
