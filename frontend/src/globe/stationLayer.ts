import {
  Cartesian2,
  Cartesian3,
  Color,
  LabelStyle,
  VerticalOrigin,
  type Entity,
  ImageryLayer,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { useLayersStore } from '../stores/layers'
import { useLocaleStore } from '../i18n/useLocale'
import { ringToTint } from '../places/tint'
import { stationLabel } from '../stations/presets'
import { usePassesStore } from '../stores/passes'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import { addOrdered, IMAGERY_BAND } from './imageryOrder'
import { crispLabel } from './labelStyle'
import { createTintProvider, type TintShape } from './tintProvider'

/** Fill opacity of the visibility areas; the outline is drawn solid. */
const VISIBILITY_OPACITY = 0.2

/** Ground station markers and the tinted visibility area of the last pass prediction. */
export function useStationLayer(viewer: Viewer) {
  const passes = usePassesStore()
  const layers = useLayersStore()
  const theme = useThemePreset()
  const locale = useLocaleStore()
  let entities: Entity[] = []
  let visibility: ImageryLayer | null = null

  function clear() {
    entities.forEach((entity) => viewer.entities.remove(entity))
    entities = []
    removeVisibility()
  }

  function render() {
    clear()
    if (!layers.prefs.showStations) return
    const palette = theme.preset.globe.stationPalette
    const colorOf = (id: number) =>
      Color.fromCssColorString(stationColorHex(passes.colorIndexOf(id), palette))

    for (const station of passes.stations) {
      const chosen = passes.isSelected(station.id)
      const name = stationLabel(station, locale.locale)
      // An unselected station stays on the globe but recedes, so it reads as available.
      const color = chosen ? colorOf(station.id) : colorOf(station.id).withAlpha(0.35)
      entities.push(
        viewer.entities.add({
          id: `station:${station.id}`,
          name,
          position: Cartesian3.fromDegrees(station.lon_deg, station.lat_deg, station.alt_m),
          point: {
            pixelSize: chosen ? 9 : 7,
            color,
            outlineColor: Color.WHITE.withAlpha(chosen ? 1 : 0.5),
            outlineWidth: 2,
          },
          label: {
            text: name,
            ...crispLabel(12),
            style: LabelStyle.FILL_AND_OUTLINE,
            fillColor: Color.WHITE.withAlpha(chosen ? 1 : 0.6),
            outlineColor: Color.BLACK.withAlpha(0.7),
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -10),
          },
        }),
      )
    }

    drawVisibility(palette)
  }

  /**
   * Tint each selected station's visibility area from the last pass prediction in its
   * colour. Painted as imagery like the country tint, so it drapes over the globe, hides
   * behind it, and handles areas that cross the antimeridian or enclose a pole.
   */
  function drawVisibility(palette: readonly string[]) {
    // A station deselected or deleted since the prediction loses its area, and so does one
    // whose contacts were all switched off with their eye toggles.
    // The selected run's satellite (else the first): reach depends on the orbit height.
    const shapes: TintShape[] = passes.results
      .filter(
        (item) => passes.isSelected(item.station.id) && passes.stationHasShownPass(item.station.id),
      )
      .map((item) => {
        const color = stationColorHex(passes.colorIndexOf(item.station.id), palette)
        return {
          ...ringToTint(item.visibility.ring),
          fill: color,
          stroke: color,
          strokeWidth: 2,
        }
      })
      .filter((shape) => shape.rings.length > 0)
    if (!shapes.length) return
    visibility = addOrdered(
      viewer,
      new ImageryLayer(createTintProvider(shapes, VISIBILITY_OPACITY)),
      IMAGERY_BAND.visibility,
    )
  }

  function removeVisibility() {
    if (visibility && viewer.imageryLayers.contains(visibility)) {
      viewer.imageryLayers.remove(visibility)
    }
    visibility = null
  }

  watch(
    () => [
      passes.stations,
      passes.result,
      passes.selectedIds,
      passes.hidden,
      layers.prefs.showStations,
      theme.preset.id,
      locale.locale,
    ],
    render,
    { immediate: true },
  )

  return { dispose: clear }
}
