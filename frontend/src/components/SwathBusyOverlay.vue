<template>
  <v-fade-transition>
    <div v-if="selection.busy" class="swath-busy" aria-live="polite">
      <v-progress-circular indeterminate color="primary" size="22" width="2.5" />
      <span>{{ text }}</span>
    </div>
  </v-fade-transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSelectionStore } from '../stores/selection'

const { t } = useI18n()
const selection = useSelectionStore()

/** Computing on the server, then drawing: the fill goes up a block at a time. */
const text = computed(() => {
  if (selection.loading) return t('app.swathBusy.computing')
  const progress = selection.drawProgress
  return progress && progress.total > 1
    ? t('app.swathBusy.drawingProgress', progress)
    : t('app.swathBusy.drawing')
})
</script>

<style scoped>
/* Centred over the globe; the globe stays interactive underneath. */
.swath-busy {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border: 1px solid rgba(var(--v-theme-primary), 0.5);
  border-radius: 14px;
  background: rgba(var(--v-theme-surface), 0.88);
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  font-weight: 600;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
</style>
