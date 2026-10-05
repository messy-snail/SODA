import {
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HorizontalOrigin,
  ImageryLayer,
  LabelCollection,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { useLocaleStore } from '../i18n/useLocale'
import { pick } from '../i18n/label'
import { loadCountries, loadShapes, type Country } from '../places/geoData'
import type { IndexedShape } from '../places/tint'
import { useLayersStore } from '../stores/layers'
import { useThemePreset } from '../theme/useThemePreset'
import { addOrdered, IMAGERY_BAND } from './imageryOrder'
import { createTintProvider } from './tintProvider'
import { crispLabel } from './labelStyle'

const LABEL_HEIGHT_M = 1_000

/** Camera distance up to which a country of each label rank is named. */
function labelRange(rank: number): number {
  if (rank <= 2) return 40_000_000
  if (rank <= 4) return 14_000_000
  return 6_000_000
}

/**
 * Countries from Natural Earth: a tint that tells neighbours apart, their outlines, and
 * their names, each with its own switch. The tint and outlines are one imagery overlay, so
 * the globe hides the far side exactly as it hides the basemap.
 */
export function useBorderLayer(viewer: Viewer) {
  const layers = useLayersStore()
  const theme = useThemePreset()
  const locale = useLocaleStore()
  const labels = viewer.scene.primitives.add(new LabelCollection()) as LabelCollection
  let overlay: ImageryLayer | null = null
  let shapes: IndexedShape[] | null = null
  let countries: Country[] | null = null
  let disposed = false

  function removeOverlay() {
    if (overlay && viewer.imageryLayers.contains(overlay)) viewer.imageryLayers.remove(overlay)
    overlay = null
  }

  /** Rebuild the overlay; its tiles are painted once, so a style change needs a new one. */
  function drawOverlay() {
    removeOverlay()
    const { showCountryTint, showBorders } = layers.prefs
    if ((!showCountryTint && !showBorders) || !shapes) return
    const globe = theme.preset.globe
    const palette = globe.countryTintPalette
    const tinted = shapes.map((shape) => ({
      rings: shape.rings,
      bbox: shape.bbox,
      // MAPCOLOR7 runs 1-7, so neighbouring countries never share a fill.
      fill: showCountryTint ? palette[(shape.color - 1) % palette.length]! : null,
      stroke: showBorders ? globe.border : null,
    }))
    const provider = createTintProvider(tinted, globe.countryTintOpacity)
    // Above the basemap and user imagery, below the pass visibility tints.
    overlay = addOrdered(viewer, new ImageryLayer(provider), IMAGERY_BAND.tint)
  }

  function drawLabels() {
    labels.removeAll()
    if (!layers.prefs.showCountryLabels || !countries) return
    const fill = Color.fromCssColorString(theme.preset.globe.countryLabel)
    const outline = Color.fromCssColorString(theme.preset.globe.countryLabelOutline).withAlpha(0.8)
    for (const country of countries) {
      const size = country.rank <= 2 ? 14 : country.rank <= 4 ? 12 : 11
      labels.add({
        id: { kind: 'country-label', iso2: country.iso2 },
        position: Cartesian3.fromDegrees(country.label[0], country.label[1], LABEL_HEIGHT_M),
        text: pick(country.name, locale.locale),
        ...crispLabel(size),
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: fill,
        outlineColor: outline,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        distanceDisplayCondition: new DistanceDisplayCondition(0, labelRange(country.rank)),
        scaleByDistance: new NearFarScalar(2_000_000, 1.1, 30_000_000, 0.75),
      })
    }
  }

  /** Fetch whatever the switches need the first time, then redraw the part that changed. */
  async function refresh(part: 'overlay' | 'labels') {
    const { showCountryTint, showBorders, showCountryLabels } = layers.prefs
    try {
      if (part === 'overlay' && (showCountryTint || showBorders) && !shapes) {
        shapes = await loadShapes()
      }
      if (part === 'labels' && showCountryLabels && !countries) countries = await loadCountries()
    } catch (error) {
      console.warn('SODA: country data unavailable', error)
    }
    if (disposed) return
    if (part === 'overlay') drawOverlay()
    else drawLabels()
  }

  watch(
    () => [layers.prefs.showCountryTint, layers.prefs.showBorders, theme.preset.globe],
    () => void refresh('overlay'),
    { immediate: true },
  )
  watch(
    () => [layers.prefs.showCountryLabels, locale.locale, theme.preset.globe],
    () => void refresh('labels'),
    { immediate: true },
  )

  return {
    dispose() {
      disposed = true
      removeOverlay()
      viewer.scene.primitives.remove(labels)
    },
  }
}
