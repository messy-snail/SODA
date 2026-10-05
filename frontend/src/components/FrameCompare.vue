<template>
  <div class="frame-compare">
    <v-switch
      v-model="comparison.enabled"
      color="frame-inertial"
      :label="t('propagate.runs.compare')"
    />
    <div v-if="comparison.enabled" class="comparison-legend">
      <strong v-if="comparison.target">{{ comparison.target.name }}</strong>
      <span :style="{ '--path-color': groundColor }"
        ><i class="ground-line" />{{ t('propagate.runs.groundLegend') }}</span
      >
      <span :style="{ '--path-color': theme.preset.globe.inertialReference }"
        ><i class="space-line" />{{ t('propagate.runs.spaceLegend') }}</span
      >
      <p v-if="comparison.reason" aria-live="polite">
        {{ t(`propagate.runs.${comparison.reason}`) }}
      </p>
    </div>
    <p v-if="runs.trackedRunId" class="tracking-note">{{ t('propagate.runs.trackingView') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useComparisonStore } from '../stores/comparison'
import { useRunsStore } from '../stores/runs'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'

const { t } = useI18n()
const comparison = useComparisonStore()
const runs = useRunsStore()
const theme = useThemePreset()
const groundColor = computed(() =>
  orbitColorHex(comparison.target?.colorIndex ?? 0, theme.preset.globe.orbitPalette),
)
</script>

<style scoped>
.frame-compare {
  display: grid;
  gap: 6px;
  padding: 4px 0 6px 14px;
  border-left: 3px solid rgb(var(--v-theme-frame-inertial));
  border-radius: 2px;
}
.comparison-legend {
  display: grid;
  gap: 8px;
  padding-bottom: 2px;
  font-size: 12px;
}
.comparison-legend strong {
  font-size: 13px;
}
.comparison-legend span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.comparison-legend i {
  width: 24px;
  flex-shrink: 0;
  border-top: 3px solid var(--path-color);
}
.comparison-legend .space-line {
  border-top-style: dashed;
}
.comparison-legend p,
.tracking-note {
  margin: 4px 0 0;
  color: rgb(var(--v-theme-secondary));
  font-size: 12px;
}
</style>
