<template>
  <DashboardCard :title="t('app.tool.satellite.label')" eyebrow="ORBIT" :icon="Satellite" fill>
    <nav class="steps" :aria-label="t('app.satelliteStep.label')">
      <template v-for="(step, index) in SATELLITE_STEPS" :key="step">
        <span v-if="index" class="steps__line" aria-hidden="true" />
        <button
          type="button"
          class="step"
          :class="{ 'step--current': ui.satelliteStep === step, 'step--done': done(step) }"
          :aria-current="ui.satelliteStep === step ? 'step' : undefined"
          :data-testid="`satellite-step-${step}`"
          @click="ui.satelliteStep = step"
        >
          <span class="step__badge">
            <Check v-if="done(step)" :size="12" aria-hidden="true" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="step__label">{{ t(`app.satelliteStep.${step}`) }}</span>
          <span v-if="count(step)" class="step__count">{{ count(step) }}</span>
        </button>
      </template>
    </nav>
    <SatelliteSearchCard v-if="ui.satelliteStep === 'pick'" />
    <PropagationCard v-else-if="ui.satelliteStep === 'propagate'" />
    <template v-else>
      <OrbitRunsCard />
      <div v-if="runs.runs.length" class="next">
        <p class="muted text-caption">{{ t('app.satelliteStep.toSwathHint') }}</p>
        <v-btn variant="tonal" color="primary" block @click="ui.openTool('swath')">
          <ScanLine :size="15" class="mr-2" aria-hidden="true" />{{
            t('app.satelliteStep.toSwath')
          }}
        </v-btn>
      </div>
    </template>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Check, Satellite, ScanLine } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useRunsStore } from '../stores/runs'
import { SATELLITE_STEPS, useUiStore, type SatelliteStep } from '../stores/ui'
import DashboardCard from './DashboardCard.vue'
import OrbitRunsCard from './OrbitRunsCard.vue'
import PropagationCard from './PropagationCard.vue'
import SatelliteSearchCard from './SatelliteSearchCard.vue'

/**
 * Satellite search and propagation as one tool, one page at a time: pick a satellite, set up
 * the run, then look at the runs. Each page's main button moves on to the next; the step bar
 * goes back (or ahead) directly.
 */
const { t } = useI18n()
const ui = useUiStore()
const basket = useSatelliteBasketStore()
const runs = useRunsStore()

/** A step counts as done once what it produces exists: a chosen satellite, a run. */
function done(step: SatelliteStep) {
  if (step === ui.satelliteStep) return false
  if (step === 'pick') return basket.items.length > 0
  if (step === 'propagate') return runs.runs.length > 0
  return false
}

/** Picked satellites on the first step, runs on the last. */
function count(step: SatelliteStep): number {
  if (step === 'pick') return basket.items.length
  if (step === 'runs') return runs.runs.length
  return 0
}
</script>

<style scoped>
.steps {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: -4px 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.steps__line {
  flex: 1 1 4px;
  min-width: 4px;
  height: 1px;
  background: rgba(var(--v-theme-on-surface), 0.18);
}
/* The bar must fit the narrowest sidebar in either language: labels give way first, the
   badge and the count never shrink. */
.step {
  display: inline-flex;
  flex: 0 1 auto;
  min-width: 0;
  align-items: center;
  gap: 5px;
  padding: 4px 6px 4px 4px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.64);
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 650;
}
.step:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.step:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.step__badge {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.24);
  border-radius: 50%;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.step--done {
  color: rgb(var(--v-theme-on-surface));
}
.step--done .step__badge {
  border-color: rgba(var(--v-theme-primary), 0.55);
  color: rgb(var(--v-theme-primary));
}
.step--current {
  color: rgb(var(--v-theme-primary));
}
.step--current .step__badge {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.step__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step__count {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
}
.next {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}
</style>
