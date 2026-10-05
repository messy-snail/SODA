<template>
  <div ref="container" class="globe" role="application" :aria-label="t('app.globe')" />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Viewer } from 'cesium'
import { effectScope, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hideBootSplash } from '../boot'
import { useAccessLayer } from '../globe/accessLayer'
import { useAoiLayer } from '../globe/aoiLayer'
import { useCoverageLayer } from '../globe/coverageLayer'
import { applyBasemap } from '../globe/basemaps'
import { useEclipseLayer } from '../globe/eclipseLayer'
import { useBorderLayer } from '../globe/borderLayer'
import { useInertialReferenceLayer } from '../globe/inertialReferenceLayer'
import { useLiquidGlass } from '../globe/liquidGlass'
import { useAppearanceStore } from '../stores/appearance'
import { useOrbitLayer } from '../globe/orbitLayer'
import { useReferenceFrame } from '../globe/referenceFrame'
import { useSessionRestore } from '../globe/sessionRestore'
import { usePicking } from '../globe/picking'
import { usePinLayer } from '../globe/pinLayer'
import { useSatelliteCloud } from '../globe/satelliteCloud'
import { useSensorFan } from '../globe/sensorCone'
import { usePassLayer } from '../globe/passLayer'
import { useStationLayer } from '../globe/stationLayer'
import { useSwathLayer } from '../globe/swathLayer'
import { useTmtcLayer } from '../globe/tmtcLayer'
import { useCesiumClock } from '../globe/useCesiumClock'
import { useUserImageryLayer } from '../globe/userImageryLayer'
import { useViewMetrics } from '../globe/viewMetrics'
import { createViewer } from '../globe/useViewer'
import { useViewControl } from '../globe/viewControl'
import { useLayersStore } from '../stores/layers'
import { usePlacesStore } from '../stores/places'
import { useUiStore } from '../stores/ui'
import { useThemePreset } from '../theme/useThemePreset'

const { t } = useI18n()

const container = ref<HTMLDivElement>()
const layers = useLayersStore()
const ui = useUiStore()
const places = usePlacesStore()
const theme = useThemePreset()
const appearance = useAppearanceStore()
const scope = effectScope()
let viewer: Viewer | null = null
let disposers: Array<{ dispose(): void }> = []

onMounted(() => {
  viewer = markRaw(createViewer(container.value!, places.saved.home))
  const v = viewer
  // The base sphere and its background are painted on the very first frame, so the splash can
  // step aside then; waiting for streamed tiles would hang whenever imagery is unreachable.
  const stopBoot = v.scene.postRender.addEventListener(() => {
    stopBoot()
    hideBootSplash()
  })
  // Browser smoke tests locate orbit pixels through the viewer; opt-in only.
  if (new URLSearchParams(location.search).has('e2e')) {
    ;(window as unknown as { __sodaViewer?: Viewer }).__sodaViewer = v
  }
  scope.run(() => {
    const orbit = useOrbitLayer(v)
    const view = useViewControl(v)
    const glass = useLiquidGlass(v)
    appearance.refractionSupported = glass.refractionSupported
    disposers = [
      useCesiumClock(v),
      useReferenceFrame(v),
      useUserImageryLayer(v),
      useBorderLayer(v),
      useEclipseLayer(v),
      orbit,
      useInertialReferenceLayer(v),
      useSwathLayer(v),
      useSensorFan(v),
      useStationLayer(v),
      usePassLayer(v),
      useTmtcLayer(v),
      usePinLayer(v),
      useAoiLayer(v),
      useCoverageLayer(v),
      useAccessLayer(v),
      useSatelliteCloud(v),
      usePicking(v, orbit),
      view,
      useViewMetrics(v),
      glass,
    ]
    // Last, so the clock, runs and camera control it restores into already exist.
    disposers.push(useSessionRestore(v, view))
    watch(
      () => layers.prefs.basemapOverride ?? theme.preset.globe.basemap,
      (id) => applyBasemap(v, id),
      { immediate: true },
    )
    // Cesium shades the flat map with a hard day/night seam, so its lighting is 3D only; the
    // 2D map gets its night side from the eclipse layer under the same switch.
    watch(
      () => layers.prefs.lighting && ui.sceneMode === '3d',
      (lighting) => {
        v.scene.globe.enableLighting = lighting
      },
      { immediate: true },
    )
  })
})

onBeforeUnmount(() => {
  scope.stop()
  disposers.reverse().forEach((item) => item.dispose())
  disposers = []
  viewer?.destroy()
  viewer = null
})
</script>

<style scoped>
.globe {
  position: absolute;
  inset: 0;
}
/* The credit line itself is placed in styles.css, next to the dock it sits under. */
.globe :deep(.soda-credit) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 10.5px;
  font-weight: 760;
  letter-spacing: 0.8px;
  vertical-align: middle;
}
.globe :deep(.soda-credit img) {
  width: 14px;
  height: 14px;
}
/* The credit HTML is static, so the theme picks its mark here instead of rebuilding the Credit. */
.globe :deep(.soda-credit .on-dark) {
  display: none;
}
html[data-theme='dark'] .globe :deep(.soda-credit .on-light) {
  display: none;
}
html[data-theme='dark'] .globe :deep(.soda-credit .on-dark) {
  display: inline;
}
</style>
