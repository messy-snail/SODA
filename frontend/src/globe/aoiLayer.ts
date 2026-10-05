import {
  Cartesian2,
  Cartesian3,
  Color,
  LabelStyle,
  Rectangle,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { targetCenter } from '../mission/targets'
import { useCoverageStore } from '../stores/coverage'
import { useMissionStore } from '../stores/mission'
import { useThemePreset } from '../theme/useThemePreset'

/**
 * Imaging targets of the mission tool: a dot for a point, a tinted rectangle for an area,
 * each with its name. Entity ids are `aoi:<target id>`; the first corner of an area being
 * clicked out is `aoi-draft`.
 */
export function useAoiLayer(viewer: Viewer) {
  const mission = useMissionStore()
  const coverage = useCoverageStore()
  const theme = useThemePreset()
  let entities: Entity[] = []

  /** The box the coverage map is painted over right now. */
  const mapped = (id: string) => coverage.shown && coverage.result?.targetId === id

  function clear() {
    entities.forEach((entity) => viewer.entities.remove(entity))
    entities = []
  }

  function render() {
    if (viewer.isDestroyed()) return
    clear()
    const globe = theme.preset.globe
    const color = Color.fromCssColorString(globe.aoi)
    const outline = Color.fromCssColorString(globe.chipBackground)
    for (const target of mission.saved.targets) {
      const focused = mission.focusedTargetId === target.id
      const center = targetCenter(target)
      const label = {
        text: target.name,
        font: `${focused ? 700 : 600} 12px sans-serif`,
        fillColor: Color.fromCssColorString(globe.chipText),
        outlineColor: outline,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -10),
      }
      const position = Cartesian3.fromDegrees(center.lon_deg, center.lat_deg)
      if (target.kind === 'point') {
        entities.push(
          viewer.entities.add({
            id: `aoi:${target.id}`,
            position,
            point: {
              pixelSize: focused ? 12 : 9,
              color,
              outlineColor: outline,
              outlineWidth: 2,
            },
            label,
          }),
        )
        continue
      }
      entities.push(
        viewer.entities.add({
          id: `aoi:${target.id}`,
          position,
          rectangle: {
            coordinates: Rectangle.fromDegrees(
              target.west_deg,
              target.south_deg,
              target.east_deg,
              target.north_deg,
            ),
            // A box under the coverage map keeps its outline only, so its own tint does
            // not shift the colours the legend explains.
            fill: !mapped(target.id),
            material: color.withAlpha(focused ? 0.32 : 0.18),
            outline: true,
            outlineColor: color,
            height: 0,
          },
          label,
        }),
      )
    }
    const corner = mission.corner
    if (corner) {
      entities.push(
        viewer.entities.add({
          id: 'aoi-draft',
          position: Cartesian3.fromDegrees(corner.lon_deg, corner.lat_deg),
          point: { pixelSize: 8, color, outlineColor: outline, outlineWidth: 2 },
        }),
      )
    }
  }

  const stop = watch(
    () => [
      mission.saved.targets,
      mission.corner,
      mission.focusedTargetId,
      theme.preset,
      coverage.shown,
      coverage.result,
    ],
    render,
    { deep: true, immediate: true },
  )

  return {
    dispose() {
      stop()
      clear()
    },
  }
}
