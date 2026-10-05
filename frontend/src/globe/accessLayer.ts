import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  Color,
  JulianDate,
  PolygonHierarchy,
  PolylineDashMaterialProperty,
  type Entity,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import type { AccessWindow } from '../api/types'
import { satSlug } from '../mission/shots'
import { useMissionStore } from '../stores/mission'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { trackPositions } from './contactGraphics'
import { interpolateTrack } from './passTrack'

/** Fill of an imaged strip; its edge line is drawn at full strength. */
const STRIP_ALPHA = 0.35
const TRACK_WIDTH_PX = 6

interface Sight {
  startMs: number
  endMs: number
  track: readonly number[]
  aim: Cartesian3
}

/** ``[lon, lat, lon, lat, ...]`` as positions on the ellipsoid. */
function lonLatPositions(flat: readonly number[]): Cartesian3[] {
  return Cartesian3.fromDegreesArray(flat as number[])
}

/**
 * Imaging opportunities on the globe: each window's imaged strip (``access:<shot key>``,
 * pickable), the stretch of orbit flown while imaging, and per satellite a dashed line to
 * the aim point while the clock is inside one of its shots
 * (``access-sight:<satellite slug>``). With one satellite they take the target colour; with
 * several, each satellite's orbit colour.
 */
export function useAccessLayer(viewer: Viewer) {
  const mission = useMissionStore()
  const theme = useThemePreset()
  let entities: Entity[] = []

  function clear() {
    entities.forEach((entity) => viewer.entities.remove(entity))
    entities = []
  }

  function render() {
    clear()
    const globe = theme.preset.globe
    const sights = new Map<string, { color: Color; shots: Sight[] }>()
    for (const shot of mission.shots) {
      const { window } = shot
      if (window.strip.left.length < 4) continue
      const color = Color.fromCssColorString(
        mission.multi ? orbitColorHex(shot.run.colorIndex, globe.orbitPalette) : globe.aoi,
      )
      entities.push(strip(`access:${shot.key}`, window, color))
      entities.push(
        viewer.entities.add({
          id: `access-track:${shot.key}`,
          polyline: {
            positions: trackPositions(window.track_fixed_m),
            width: TRACK_WIDTH_PX,
            arcType: ArcType.NONE,
            material: color,
            depthFailMaterial: color,
          },
        }),
      )
      const slug = satSlug(shot.satKey)
      const sight = sights.get(slug) ?? { color, shots: [] }
      sight.shots.push({
        startMs: Date.parse(window.shot_start),
        endMs: Date.parse(window.shot_end),
        track: window.track_fixed_m,
        aim: Cartesian3.fromDegrees(window.aim_lon_deg, window.aim_lat_deg),
      })
      sights.set(slug, sight)
    }
    for (const [slug, sight] of sights) {
      entities.push(lineOfSight(`access-sight:${slug}`, sight.shots, sight.color))
    }
  }

  function strip(id: string, window: AccessWindow, color: Color): Entity {
    const left = lonLatPositions(window.strip.left)
    const right = lonLatPositions(window.strip.right)
    return viewer.entities.add({
      id,
      polygon: {
        hierarchy: new PolygonHierarchy([...left, ...right.reverse()]),
        material: color.withAlpha(STRIP_ALPHA),
        height: 0,
        outline: true,
        outlineColor: color,
      },
    })
  }

  /** Satellite to aim point, only while the Cesium clock is inside one of its shots. */
  function lineOfSight(id: string, shots: Sight[], color: Color): Entity {
    const scratch = new Cartesian3()
    const none: Cartesian3[] = []
    return viewer.entities.add({
      id,
      polyline: {
        positions: new CallbackProperty((time) => {
          if (!time) return none
          const ms = JulianDate.toDate(time).getTime()
          for (const shot of shots) {
            const at = interpolateTrack(shot.track, shot.startMs, shot.endMs, ms)
            if (at) return [Cartesian3.fromElements(at[0], at[1], at[2], scratch), shot.aim]
          }
          return none
        }, false),
        width: 2,
        arcType: ArcType.NONE,
        material: new PolylineDashMaterialProperty({ color, dashLength: 12 }),
      },
    })
  }

  const stop = watch(() => [mission.shots, mission.multi, theme.preset], render, {
    immediate: true,
  })

  return {
    dispose() {
      stop()
      clear()
    },
  }
}
