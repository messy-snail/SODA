<template>
  <DashboardCard :title="t('layers.title')" eyebrow="GLOBE" :icon="Layers">
    <div class="form-stack">
      <v-select
        v-model="layers.prefs.basemapOverride"
        :items="basemapItems"
        :label="t('layers.basemap')"
      />
      <p class="muted text-caption hint">
        {{ t('layers.basemapHint') }}
      </p>

      <v-switch v-model="layers.prefs.showSatellites" :label="t('layers.showSatellites')" />
      <div v-if="layers.prefs.showSatellites" class="cloud-status">
        <v-progress-linear v-if="layers.cloud.loading" indeterminate color="primary" height="2" />
        <p v-else-if="layers.cloud.error" class="text-caption text-warning">
          {{ layers.cloud.error }}
        </p>
        <p v-else class="muted text-caption">
          {{ t('layers.objectCount', { count: layers.cloud.count.toLocaleString() }) }}
        </p>
        <SatelliteStyleSection />
      </div>

      <v-switch v-model="layers.prefs.lighting" :label="t('layers.lighting')" />
      <v-switch v-model="layers.prefs.showScaleBar" :label="t('layers.showScaleBar')" />
      <v-switch v-model="layers.prefs.showEclipse" :label="t('layers.showEclipse')" />
      <p v-if="layers.prefs.showEclipse" class="muted text-caption hint">
        {{ t('layers.eclipseHint') }}
      </p>
      <v-switch v-model="layers.prefs.showStations" :label="t('layers.showStations')" />
      <v-switch v-model="layers.prefs.showCountryTint" :label="t('layers.showCountryTint')" />
      <v-switch v-model="layers.prefs.showBorders" :label="t('layers.showBorders')" />
      <v-switch v-model="layers.prefs.showCountryLabels" :label="t('layers.showCountryLabels')" />
      <p
        v-if="
          layers.prefs.showCountryTint || layers.prefs.showBorders || layers.prefs.showCountryLabels
        "
        class="muted text-caption hint"
      >
        {{ t('layers.bordersSource') }}
      </p>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Layers } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { basemaps } from '../globe/basemaps'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import { useLayersStore } from '../stores/layers'
import { useThemePreset } from '../theme/useThemePreset'
import DashboardCard from './DashboardCard.vue'
import SatelliteStyleSection from './SatelliteStyleSection.vue'

const { t } = useI18n()
const locale = useLocaleStore()
const layers = useLayersStore()
const theme = useThemePreset()

const basemapItems = computed(() => {
  const themeDefault = basemaps.find((item) => item.id === theme.preset.globe.basemap)
  return [
    {
      title: t('layers.themeDefault', {
        name: themeDefault ? pick(themeDefault.label, locale.locale) : '',
      }),
      value: null,
    },
    ...basemaps.map((item) => ({ title: pick(item.label, locale.locale), value: item.id })),
  ]
})
</script>

<style scoped>
.hint {
  margin-top: calc(var(--space-1) - var(--stack-gap));
}
.cloud-status {
  display: grid;
  gap: 6px;
  margin-top: calc(var(--space-2) - var(--stack-gap));
}
</style>
