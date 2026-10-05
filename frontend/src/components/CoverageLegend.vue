<template>
  <div class="legend" role="img" :aria-label="label" data-testid="coverage-legend">
    <div class="ramp" :style="{ background: gradient }" />
    <div class="ends">
      <span>{{ low }}</span>
      <span class="empty">
        <i :style="{ background: emptyColor }" aria-hidden="true" />{{ emptyLabel }}
      </span>
      <span>{{ high }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useThemePreset } from '../theme/useThemePreset'

/** The colour ramp of the coverage map with the values at its two ends. */
defineProps<{ label: string; low: string; high: string; emptyLabel: string }>()

const theme = useThemePreset()
const gradient = computed(
  () => `linear-gradient(90deg, ${theme.preset.globe.coverage.ramp.join(', ')})`,
)
const emptyColor = computed(() => theme.preset.globe.coverage.empty)
</script>

<style scoped>
.ramp {
  height: 10px;
  border-radius: 5px;
}
.ends {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 3px;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
}
.empty {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.empty i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
</style>
