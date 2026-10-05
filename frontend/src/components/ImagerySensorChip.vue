<template>
  <v-chip
    size="x-small"
    variant="tonal"
    :color="`sensor-${sensor}`"
    class="sensor-chip"
    :title="t(`imagery.sensorFull.${sensor}`)"
  >
    <component :is="ICONS[sensor]" :size="11" class="sensor-icon" aria-hidden="true" />
    {{ t(`imagery.sensor.${sensor}`) }}
  </v-chip>
</template>

<script setup lang="ts">
import { Camera, Radar } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { ImagerySensor } from '../api/types'

/** What took an image, as an icon and a colour of its own, so the two kinds read at a glance. */
defineProps<{ sensor: ImagerySensor }>()

const { t } = useI18n()
const ICONS = { optical: Camera, sar: Radar }
</script>

<style scoped>
.sensor-chip {
  flex: none;
}
.sensor-icon {
  margin-right: 3px;
}
</style>
