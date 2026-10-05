<template>
  <DashboardCard :title="t('markers.title')" eyebrow="MARKERS" :icon="Shapes">
    <template #append>
      <v-btn
        icon
        size="x-small"
        variant="text"
        :aria-label="t('markers.refreshLogos')"
        @click="logos.load()"
      >
        <RefreshCw :size="15" />
      </v-btn>
    </template>
    <div class="form-stack">
      <p class="section-label">{{ t('markers.shapeSection') }}</p>
      <v-btn-toggle v-model="style.shape" class="segmented">
        <v-btn v-for="option in shapeOptions" :key="option.value" :value="option.value">
          <component :is="option.icon" :size="15" class="mr-1" aria-hidden="true" />
          {{ t(`markers.shapes.${option.value}`) }}
        </v-btn>
      </v-btn-toggle>

      <template v-if="style.shape !== 'point'">
        <div class="slider-row">
          <span>{{ t('markers.size') }}</span>
          <v-slider
            v-model="style.size_m"
            :min="MARKER_SIZE_RANGE[0]"
            :max="MARKER_SIZE_RANGE[1]"
            :step="1"
            color="primary"
            hide-details
            density="compact"
            :aria-label="t('markers.sizeLabel')"
          />
          <output>{{ style.size_m }} m</output>
        </div>
        <div class="slider-row">
          <span>{{ t('markers.minSize') }}</span>
          <v-slider
            v-model="style.minimum_size_px"
            :min="MARKER_PIXEL_RANGE[0]"
            :max="MARKER_PIXEL_RANGE[1]"
            :step="4"
            color="primary"
            hide-details
            density="compact"
            :aria-label="t('markers.minSizeLabel')"
          />
          <output>{{ style.minimum_size_px }} px</output>
        </div>
      </template>

      <ul class="notes muted">
        <li>
          {{ t('markers.notes.faces') }}
        </li>
        <li>
          <i18n-t keypath="markers.notes.upload" scope="global">
            <template #path><code>data/logos</code></template>
          </i18n-t>
        </li>
        <li>
          {{ t('markers.notes.fallback') }}
        </li>
        <li>{{ t('markers.notes.minimumSize') }}</li>
      </ul>
      <v-alert v-if="logos.loadError" type="warning" variant="tonal" density="compact">
        {{ logos.loadError }}
      </v-alert>

      <p class="section-label">{{ t('markers.defaultLogoSection') }}</p>
      <LogoSlot
        :name="DEFAULT_NAME"
        :label="t('markers.defaultLogo')"
        :empty-text="t('markers.defaultLogoHint')"
      />

      <p class="section-label">{{ t('markers.operatorSection') }}</p>
      <OperatorLogoList />

      <p class="section-label">{{ t('markers.perSatelliteSection') }}</p>
      <LogoSlot
        v-if="selectedSlot"
        :key="`selected-${selectedSlot.name}`"
        :name="selectedSlot.name"
        :label="selectedSlot.label"
        :empty-text="fallbackLogoText"
        data-testid="selected-satellite-logo"
      />
      <LogoSlot
        v-for="logo in perSatellite"
        :key="logo.name"
        :name="logo.name"
        :label="`NORAD ${logo.norad_id}`"
      />
      <div v-if="!perSatellite.length && !selectedSlot" class="empty-hint">
        {{ t('markers.perSatelliteHint') }}
      </div>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Box, Circle, CircleDot, RefreshCw, Shapes } from 'lucide-vue-next'
import { computed, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import { useLayersStore } from '../stores/layers'
import { useLogosStore } from '../stores/logos'
import { useRunsStore } from '../stores/runs'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { MARKER_PIXEL_RANGE, MARKER_SIZE_RANGE } from '../utils/markerStyle'
import { DEFAULT_NAME } from '../utils/namedFiles'
import { operatorKey, operatorTitle } from '../utils/operators'
import DashboardCard from './DashboardCard.vue'
import LogoSlot from './LogoSlot.vue'
import OperatorLogoList from './OperatorLogoList.vue'

const shapeOptions = [
  { value: 'point', icon: markRaw(CircleDot) },
  { value: 'sphere', icon: markRaw(Circle) },
  { value: 'cube', icon: markRaw(Box) },
] as const

const { t } = useI18n()
const layers = useLayersStore()
const logos = useLogosStore()
const style = computed(() => layers.prefs.markerStyle)
const locale = useLocaleStore()
const runs = useRunsStore()
const basket = useSatelliteBasketStore()

/**
 * The satellite in hand (the run open in the swath tool, else the first picked one); listed
 * first so it can get a logo of its own.
 */
const current = computed(() => {
  const run = runs.selectedRun
  if (run) return { noradId: run.noradId, name: run.name }
  const picked = basket.focus
  return picked
    ? { noradId: basket.detailOf(picked.ref)?.norad_id ?? picked.ref.noradId, name: picked.name }
    : null
})

const selectedSlot = computed(() => {
  const selected = current.value
  if (!selected) return null
  return { name: String(selected.noradId), label: `${selected.name} · NORAD ${selected.noradId}` }
})

const perSatellite = computed(() =>
  logos.items.filter((logo) => logo.norad_id !== null && logo.name !== selectedSlot.value?.name),
)

/** What the selected satellite falls back to when it has no logo of its own. */
const fallbackLogoText = computed(() => {
  const selected = current.value
  if (!selected) return t('catalog.logo.none')
  const operator = operatorKey(selected.name, selected.noradId)
  if (operator && logos.find(operator)) {
    return t('catalog.logo.fallbackOperator', {
      operator: operatorTitle(operator, locale.locale),
    })
  }
  return logos.find(DEFAULT_NAME) ? t('catalog.logo.fallbackDefault') : t('catalog.logo.none')
})
</script>

<style scoped>
.slider-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.slider-row output {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-secondary));
}
</style>
