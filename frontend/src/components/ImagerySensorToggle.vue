<template>
  <v-btn-toggle
    :model-value="modelValue"
    class="segmented"
    mandatory
    :aria-label="t('imagery.sensor.label')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-btn
      v-for="option in OPTIONS"
      :key="option"
      :value="option"
      :data-testid="`imagery-sensor-${option || 'unset'}`"
    >
      {{ t(`imagery.sensor.${option || 'unset'}`) }}
    </v-btn>
  </v-btn-toggle>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ImagerySensor } from '../api/types'

/** Says what took an image: a camera, a radar, or nothing said. The empty string is "unset". */
defineProps<{ modelValue: ImagerySensor | '' }>()
const emit = defineEmits<{ 'update:modelValue': [value: ImagerySensor | ''] }>()

const { t } = useI18n()
const OPTIONS: readonly (ImagerySensor | '')[] = ['', 'optical', 'sar']
</script>
