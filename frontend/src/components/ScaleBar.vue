<template>
  <div
    v-if="layers.prefs.showScaleBar && ui.scaleBar"
    class="scale-bar glass-chip"
    role="img"
    :aria-label="t('app.scaleBar.label', { length: label })"
    :data-length-m="ui.scaleBar.length_m"
    :data-width-px="ui.scaleBar.width_px"
    data-testid="scale-bar"
  >
    <span class="rule" :style="{ width: `${ui.scaleBar.width_px}px` }" />
    <span class="label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { scaleLabel } from '../globe/scaleBar'
import { useLayersStore } from '../stores/layers'
import { useUiStore } from '../stores/ui'

/** The map scale at the middle of the view, in the strip under the dock's left end. */
const { t } = useI18n()
const ui = useUiStore()
const layers = useLayersStore()

const label = computed(() => {
  if (!ui.scaleBar) return ''
  const { value, unit } = scaleLabel(ui.scaleBar.length_m)
  return t(`app.scaleBar.${unit}`, { value: value.toLocaleString('en-US') })
})
</script>

<style scoped>
/* Mirrors the credit capsule at the other end of the same strip; see styles/shell.css. */
.scale-bar {
  position: absolute;
  bottom: 2px;
  left: var(--dock-left);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 18px;
  padding: 0 9px;
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), var(--lg-alpha, 0.8));
  backdrop-filter: var(--lg-fallback);
  -webkit-backdrop-filter: var(--lg-fallback);
  color: rgb(var(--v-theme-on-surface));
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  pointer-events: none;
}
/* A ruler: a baseline with a tick at each end. */
.rule {
  box-sizing: border-box;
  height: 6px;
  border: 1.5px solid currentColor;
  border-top: 0;
}
.label {
  white-space: nowrap;
}
</style>
