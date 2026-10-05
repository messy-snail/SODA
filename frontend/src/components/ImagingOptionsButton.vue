<template>
  <v-menu :close-on-content-click="false" location="end" :offset="20">
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        size="small"
        variant="tonal"
        color="primary"
        class="options-button"
        :aria-label="t('mission.access.options')"
        data-testid="imaging-options-open"
      >
        <Aperture :size="15" class="mr-1" aria-hidden="true" />{{ t('mission.access.options') }}
      </v-btn>
    </template>
    <v-card class="glass" width="380">
      <v-card-text class="form-stack">
        <p class="eyebrow">{{ t('mission.access.options') }}</p>
        <AccessPointingForm :run-id="sensorRun?.id ?? null" />
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { Aperture } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRunsStore } from '../stores/runs'
import { targetRun } from '../utils/satelliteRef'
import AccessPointingForm from './AccessPointingForm.vue'

/**
 * How far the sensor can point and how much light a target needs: the options the imaging
 * plan and the coverage analysis share. They open from the card heading, beside the globe,
 * so the results stay in view.
 */
const { t } = useI18n()
const runs = useRunsStore()
/** The run whose altitude turns the swath sensor into a roll limit. */
const sensorRun = computed(() => targetRun(runs.selectedRun, runs.runs, true))
</script>

<style scoped>
.options-button {
  margin-left: var(--space-2);
}
</style>
