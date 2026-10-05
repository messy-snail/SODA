import { ImageryLayer, JulianDate, type ImageryProvider, type Viewer } from 'cesium'
import { watch } from 'vue'
import { radiusAtM } from '../orbit/eclipse'
import { sunSubpoint } from '../orbit/sunDirection'
import { eclipseReferenceRun } from '../orbit/useEclipse'
import { useLayersStore } from '../stores/layers'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { useThemePreset } from '../theme/useThemePreset'
import { addOrdered, IMAGERY_BAND } from './imageryOrder'
import { capTint, shadowHalfAngleDeg } from './shadowCap'
import { TintProvider, type TintShape } from './tintProvider'

/**
 * Night caps from the terminator inward: the Sun on the horizon, then the ends of civil,
 * nautical and astronomical twilight. Painted over each other they fade the night in.
 */
const NIGHT_RADII_DEG = [90, 84, 78, 72]
/** The caps are smooth curves a degree per vertex; deeper tiles would add nothing. */
const MASK_MAX_LEVEL = 6
/** Repaint once the Sun has moved this far, about 12 s of simulated time. */
const SUN_STEP_DEG = 0.05
const HALF_ANGLE_STEP_DEG = 0.02
const MIN_REPAINT_MS = 250
/** A paused clock gets one exact repaint this long after the last one. */
const SETTLE_MS = 300

interface Painted {
  ms: number
  sunLon: number
  sunLat: number
  halfAngle: number | null
}

/**
 * Shading for the 2D map, where Cesium's globe lighting is off: the night side of the Earth,
 * and the Earth's shadow at the height of the followed satellite, so the orbit line enters the
 * shaded area exactly where the satellite enters eclipse. Both follow the Cesium clock.
 *
 * The 3D globe keeps Cesium's own lighting instead: a shadow draped on the ground would not
 * line up with an orbit drawn at altitude once the camera tilts.
 */
export function useEclipseLayer(viewer: Viewer) {
  const layers = useLayersStore()
  const runs = useRunsStore()
  const ui = useUiStore()
  const theme = useThemePreset()
  let overlay: ImageryLayer | null = null
  let provider: TintProvider | null = null
  let painted: Painted | null = null
  let paintedAt = 0
  let previousMs = NaN
  /** Set by anything other than time passing, so the next frame repaints without waiting. */
  let stale = true

  function remove() {
    if (overlay && viewer.imageryLayers.contains(overlay)) viewer.imageryLayers.remove(overlay)
    overlay = null
    provider = null
    painted = null
  }

  /** Shadow half-angle and geocentric distance of the followed run at `ms`, if it covers it. */
  function shadowAt(ms: number): { halfAngle: number; radiusM: number } | null {
    if (!layers.prefs.showEclipse) return null
    const run = eclipseReferenceRun(runs.runs, runs.selectedRun)
    const radiusM = run ? radiusAtM(run.data, (ms - run.startMs) / 1000) : null
    return radiusM === null ? null : { halfAngle: shadowHalfAngleDeg(radiusM), radiusM }
  }

  function shapesAt(
    sun: { lon_deg: number; lat_deg: number },
    shadow: ReturnType<typeof shadowAt>,
  ): TintShape[] {
    const style = theme.preset.globe.eclipse
    const center = { centerLonDeg: sun.lon_deg + 180, centerLatDeg: -sun.lat_deg }
    const shapes: TintShape[] = []
    if (layers.prefs.lighting) {
      for (const radiusDeg of NIGHT_RADII_DEG) {
        shapes.push({
          ...capTint({ ...center, radiusDeg }),
          fill: style.terminator,
          fillOpacity: style.terminatorOpacity,
          stroke: null,
        })
      }
    }
    if (shadow) {
      shapes.push({
        ...capTint({ ...center, radiusDeg: shadow.halfAngle, radiusM: shadow.radiusM }),
        fill: style.shadow,
        fillOpacity: style.shadowOpacity,
        stroke: style.shadowEdge,
        strokeWidth: 1.5,
      })
    }
    return shapes
  }

  function paint(ms: number, now: number) {
    const sun = sunSubpoint(ms)
    const shadow = shadowAt(ms)
    const shapes = shapesAt(sun, shadow)
    painted = { ms, sunLon: sun.lon_deg, sunLat: sun.lat_deg, halfAngle: shadow?.halfAngle ?? null }
    paintedAt = now
    stale = false
    if (!shapes.length) {
      if (overlay && viewer.imageryLayers.contains(overlay)) viewer.imageryLayers.remove(overlay)
      overlay = null
      provider = null
      return
    }
    // Repainting in place keeps each tile's old picture until the new one is ready. Without
    // Cesium's reload hook the layer is replaced instead, which can blink for a frame.
    if (provider && overlay && viewer.imageryLayers.contains(overlay)) {
      provider.setShapes(shapes)
      if (provider.reload()) return
      viewer.imageryLayers.remove(overlay)
    }
    provider = new TintProvider(shapes, 1, MASK_MAX_LEVEL)
    overlay = addOrdered(
      viewer,
      new ImageryLayer(provider as unknown as ImageryProvider),
      IMAGERY_BAND.shade,
    )
  }

  /** Whether the picture on the map is far enough from the truth at `ms` to redraw. */
  function moved(ms: number): boolean {
    if (!painted) return true
    const sun = sunSubpoint(ms)
    const lon = ((sun.lon_deg - painted.sunLon + 540) % 360) - 180
    if (Math.hypot(lon, sun.lat_deg - painted.sunLat) > SUN_STEP_DEG) return true
    const halfAngle = shadowAt(ms)?.halfAngle ?? null
    if ((halfAngle === null) !== (painted.halfAngle === null)) return true
    return (
      halfAngle !== null &&
      painted.halfAngle !== null &&
      Math.abs(halfAngle - painted.halfAngle) > HALF_ANGLE_STEP_DEG
    )
  }

  const removeListener = viewer.scene.preRender.addEventListener((_scene, time: JulianDate) => {
    const wanted = ui.sceneMode === '2d' && (layers.prefs.lighting || layers.prefs.showEclipse)
    if (!wanted) {
      if (overlay) remove()
      stale = true
      return
    }
    const ms = JulianDate.toDate(time).getTime()
    const now = performance.now()
    const paused = ms === previousMs
    previousMs = ms
    if (stale) return paint(ms, now)
    if (painted?.ms === ms) return
    if (now - paintedAt >= MIN_REPAINT_MS && moved(ms)) return paint(ms, now)
    if (paused && now - paintedAt >= SETTLE_MS) paint(ms, now)
  })

  const stop = watch(
    () => [
      layers.prefs.lighting,
      layers.prefs.showEclipse,
      runs.runs,
      runs.selectedRunId,
      theme.preset.id,
    ],
    () => {
      stale = true
    },
  )

  return {
    dispose() {
      stop()
      removeListener()
      remove()
    },
  }
}
