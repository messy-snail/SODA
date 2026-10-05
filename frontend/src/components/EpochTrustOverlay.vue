<template>
  <div
    v-if="color"
    class="trust-tint"
    :class="`trust-tint--${trust.level.value}`"
    :style="{ '--trust-rgb': color }"
    data-testid="epoch-trust-tint"
    aria-hidden="true"
  />
  <v-tooltip v-if="color && run" location="bottom" max-width="340">
    <template #activator="{ props: tip }">
      <button
        v-bind="tip"
        type="button"
        class="trust-badge glass-chip"
        :style="{ '--trust-rgb': color }"
        data-testid="epoch-trust-badge"
        :data-level="trust.level.value"
        aria-live="polite"
        @click="ui.openSatelliteStep('runs')"
      >
        <TriangleAlert :size="13" aria-hidden="true" />
        <strong>{{ t('propagate.trust.badge', { level: levelText }) }}</strong>
        <span class="offset">{{ t('propagate.trust.offset', { days: daysText }) }}</span>
        <span class="name">{{ run.name }}</span>
      </button>
    </template>
    {{ t('propagate.trust.hint') }}
  </v-tooltip>
</template>

<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEpochTrust } from '../orbit/useEpochTrust'
import { useUiStore } from '../stores/ui'
import { useThemePreset } from '../theme/useThemePreset'

const { t } = useI18n()
const ui = useUiStore()
const theme = useThemePreset()
const trust = useEpochTrust()

const run = computed(() => trust.reference.value?.run ?? null)

/** `r, g, b` of the grade colour, or null while the elements are still good. */
const color = computed(() => {
  const level = trust.level.value
  if (level === 'ok') return null
  const hex = theme.preset.globe.trust[level].replace('#', '')
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')
})

const levelText = computed(() => t(`propagate.trust.levels.${trust.level.value}`))
const daysText = computed(() => {
  const days = trust.days.value
  return `${days >= 0 ? '+' : '−'}${Math.abs(days).toFixed(1)}`
})
</script>

<style scoped>
/* Over the globe, under every panel; it only colours, never catches the pointer. */
.trust-tint {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  transition: background 600ms ease;
  --edge: 0.2;
  --fill: 0;
  background:
    radial-gradient(
      ellipse at center,
      rgba(var(--trust-rgb), 0) 45%,
      rgba(var(--trust-rgb), var(--edge)) 100%
    ),
    rgba(var(--trust-rgb), var(--fill));
}
.trust-tint--low {
  --edge: 0.32;
  --fill: 0.05;
}
.trust-tint--poor {
  --edge: 0.45;
  --fill: 0.1;
}
.trust-badge {
  position: absolute;
  top: calc(var(--frame-top, 0px) + 12px);
  left: 50%;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(520px, calc(100% - 32px));
  padding: 4px 10px;
  border: 1px solid rgba(var(--trust-rgb), 0.8);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), var(--lg-alpha, 0.8));
  backdrop-filter: var(--lg-fallback);
  color: rgb(var(--v-theme-on-surface));
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  transform: translateX(-50%);
  white-space: nowrap;
}
.trust-badge svg,
.trust-badge strong {
  flex: none;
  color: rgb(var(--trust-rgb));
}
.trust-badge:hover,
.trust-badge:focus-visible {
  background: rgba(var(--trust-rgb), 0.16);
}
.offset {
  flex: none;
}
.name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
}
</style>
