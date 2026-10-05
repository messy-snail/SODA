<template>
  <div class="filter-bar" data-testid="imagery-filter">
    <v-chip-group
      :model-value="imagery.filter.sensor ?? ALL"
      mandatory
      :aria-label="t('imagery.filter.sensor')"
      @update:model-value="imagery.filter.sensor = $event === ALL ? null : $event"
    >
      <v-chip :value="ALL" filter data-testid="imagery-filter-sensor-all">
        {{ t('imagery.filter.all') }}
      </v-chip>
      <v-chip
        v-for="sensor in SENSORS"
        :key="sensor"
        :value="sensor"
        :color="`sensor-${sensor}`"
        filter
        :data-testid="`imagery-filter-sensor-${sensor}`"
      >
        {{ t(`imagery.sensor.${sensor}`) }}
        <span class="count" :data-testid="`imagery-filter-count-${sensor}`">{{
          counts[sensor]
        }}</span>
      </v-chip>
    </v-chip-group>
    <v-chip-group
      :model-value="imagery.filter.maxGsd ?? ALL"
      mandatory
      :aria-label="t('imagery.filter.gsd')"
      @update:model-value="imagery.filter.maxGsd = $event === ALL ? null : $event"
    >
      <v-chip :value="ALL" filter data-testid="imagery-filter-gsd-all">
        {{ t('imagery.filter.all') }}
      </v-chip>
      <v-chip
        v-for="step in GSD_STEPS"
        :key="step"
        :value="step"
        filter
        :data-testid="`imagery-filter-gsd-${step}`"
      >
        {{ t('imagery.filter.atMost', { value: gsdLabel(step) }) }}
      </v-chip>
    </v-chip-group>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImagerySensor } from '../api/types'
import { useImageryStore } from '../stores/imagery'
import { GSD_STEPS, gsdLabel, sensorCounts } from '../utils/imagery'

/** Narrows the imagery list: one row of chips for the sensor, one for how sharp the image is. */
const { t } = useI18n()
const imagery = useImageryStore()

const ALL = 'all'
const SENSORS: readonly ImagerySensor[] = ['optical', 'sar']
const counts = computed(() => sensorCounts(imagery.items))
</script>

<style scoped>
.filter-bar {
  display: grid;
  gap: 0;
}
/* Two rows of chips are a toolbar, not content: keep them tight. */
.filter-bar :deep(.v-chip-group) {
  padding-block: 2px;
}
.filter-bar :deep(.v-slide-group__content) {
  flex-wrap: wrap;
}
/* A count in its own disc, so `EO 6` cannot be read as a name. */
.count {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.16);
  color: rgb(var(--v-theme-on-surface));
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
</style>
