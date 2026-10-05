<template>
  <div class="chips" :aria-label="t('mission.access.options')" data-testid="pointing-chips">
    <v-chip size="x-small" variant="tonal" :title="t('mission.access.pointing.label')">
      {{ t(`mission.access.pointing.${rollPitch ? 'rollPitch' : 'roll'}`) }}
    </v-chip>
    <v-chip size="x-small" variant="tonal">
      {{ t('mission.access.chips.roll', { roll: saved.maxRollDeg }) }}
    </v-chip>
    <v-chip v-if="rollPitch" size="x-small" variant="tonal">
      {{ t('mission.access.chips.pitch', { pitch: saved.maxPitchDeg }) }}
    </v-chip>
    <v-chip size="x-small" variant="tonal">
      {{ t('mission.access.chips.fov', { fov: saved.fovDeg }) }}
    </v-chip>
    <v-chip size="x-small" variant="tonal">
      {{ t('mission.access.chips.sun', { sun: saved.minSunElevDeg }) }}
    </v-chip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMissionStore } from '../stores/mission'

/** The imaging options in force, since their form is out of sight most of the time. */
const { t } = useI18n()
const saved = useMissionStore().saved
const rollPitch = computed(() => saved.pointingMode === 'roll_pitch')
</script>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
