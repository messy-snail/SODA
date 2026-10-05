<template>
  <DashboardCard :title="t('propagate.title')" :eyebrow="eyebrow" :icon="Orbit">
    <div v-if="!targets.length" class="empty-hint">
      {{ t('propagate.pickFirst') }}
      <br />
      <v-btn
        class="mt-2"
        size="small"
        variant="tonal"
        color="primary"
        @click="ui.openSatelliteStep('pick')"
      >
        {{ t('propagate.openSearch') }}
      </v-btn>
    </div>
    <div v-else class="form-stack">
      <div class="targets" data-testid="propagate-targets">
        <p class="section-label">{{ t('propagate.targets', { count: targets.length }) }}</p>
        <div v-for="target in targets" :key="target.key" class="target">
          <span class="color-dot" :style="{ background: target.color }" />
          <div>
            <strong>
              {{ target.name }}
              <v-chip v-if="target.propagator !== propagator" size="x-small" class="ml-1">
                {{ propagatorLabel(target.propagator) }}
              </v-chip>
            </strong>
            <small class="muted">{{ target.summary }}</small>
          </div>
        </div>
      </div>

      <div class="start">
        <v-text-field v-model="startInput" type="datetime-local" :label="t('propagate.start')" />
        <div class="start-picks">
          <v-chip size="small" variant="tonal" @click="setStart(Date.now())">
            <Clock :size="13" class="mr-1" aria-hidden="true" />{{ t('propagate.useNow') }}
          </v-chip>
          <v-chip size="small" variant="tonal" @click="setStart(clock.currentMs)">
            <History :size="13" class="mr-1" aria-hidden="true" />{{ t('propagate.useTimeline') }}
          </v-chip>
          <v-chip
            v-if="fileSpanStartMs !== null"
            size="small"
            variant="tonal"
            data-testid="use-file-span"
            @click="setStart(fileSpanStartMs)"
          >
            <FileClock :size="13" class="mr-1" aria-hidden="true" />{{
              t('propagate.ephemeris.useSpan')
            }}
          </v-chip>
        </div>
      </div>

      <div>
        <p class="section-label">{{ t('propagate.span') }}</p>
        <v-chip-group v-model="durationKey" mandatory selected-class="text-primary" column>
          <v-chip v-for="option in durationOptions" :key="option.key" :value="option.key" filter>
            {{ t(`propagate.spans.${option.key}`) }}
          </v-chip>
        </v-chip-group>
      </div>

      <div>
        <p class="section-label">{{ t('propagate.step') }}</p>
        <v-btn-toggle
          v-model="stepS"
          class="segmented step-toggle"
          :aria-label="t('propagate.step')"
          data-testid="propagate-step"
        >
          <v-btn v-for="option in stepOptions" :key="option.value" :value="option.value">
            {{ option.title }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <!-- SGP4 is what almost every run wants, so the choice of propagator stays folded away. -->
      <div class="advanced">
        <button
          type="button"
          class="advanced__head section-label"
          :aria-expanded="advanced"
          data-testid="propagate-advanced"
          @click="advanced = !advanced"
        >
          <ChevronDown
            :size="13"
            class="advanced__chevron"
            :class="{ 'advanced__chevron--open': advanced }"
            aria-hidden="true"
          />
          <span>{{ t('propagate.advanced') }}</span>
          <small v-if="!advanced && propagator !== 'sgp4'" class="advanced__summary">
            {{ propagatorLabel(propagator) }}
          </small>
        </button>
        <div v-show="advanced" class="advanced__body">
          <p class="section-label">{{ t('propagate.propagator') }}</p>
          <v-btn-toggle
            v-model="propagator"
            class="segmented"
            :aria-label="t('propagate.propagator')"
            data-testid="propagator"
          >
            <v-btn value="sgp4">SGP4</v-btn>
            <v-btn value="hpop">
              <FlaskConical :size="13" class="mr-1" aria-hidden="true" />HPOP
            </v-btn>
          </v-btn-toggle>
        </div>
      </div>
      <template v-if="usesHpop">
        <v-alert type="warning" variant="tonal" density="compact" data-testid="hpop-experimental">
          <template #prepend><FlaskConical :size="18" aria-hidden="true" /></template>
          <p class="hpop-warning">{{ t('propagate.hpop.experimental') }}</p>
          <p v-if="hpopFromElements" class="hpop-warning" data-testid="hpop-caveat">
            {{ t('propagate.hpop.caveat') }}
          </p>
        </v-alert>
        <CollapsibleSection
          id="hpop-options"
          :title="t('propagate.hpop.options')"
          :summary="hpopSummary"
        >
          <HpopOptionsForm v-model="hpopForm" />
        </CollapsibleSection>
      </template>

      <p class="muted text-caption estimate">
        {{ t('propagate.summary', { count: sampleCount.toLocaleString(), end: endLabel }) }}
      </p>
      <v-alert v-if="sampleCount > MAX_SAMPLES" type="warning" variant="tonal" density="compact">
        {{ t('propagate.tooManySamples', { max: MAX_SAMPLES.toLocaleString() }) }}
      </v-alert>
      <v-alert
        v-if="hpopBlocked.length"
        type="warning"
        variant="tonal"
        density="compact"
        data-testid="hpop-epoch-too-far"
      >
        {{
          t('propagate.hpop.epochTooFar', {
            days: HPOP_MAX_EPOCH_GAP_DAYS,
            names: hpopBlocked.join(', '),
          })
        }}
      </v-alert>
      <v-alert
        v-if="outsideSpan.length"
        type="warning"
        variant="tonal"
        density="compact"
        data-testid="ephemeris-no-overlap"
      >
        {{ t('propagate.ephemeris.noOverlap', { names: outsideSpan.join(', ') }) }}
      </v-alert>
      <v-alert v-if="runs.failures.length" type="error" variant="tonal" density="compact">
        <p class="failures-title">
          {{ t('propagate.someFailed', { count: runs.failures.length }) }}
        </p>
        <ul class="failures">
          <li v-for="failure in runs.failures" :key="failure.name">
            <strong>{{ failure.name }}</strong> · {{ failure.message }}
          </li>
        </ul>
      </v-alert>

      <v-btn color="primary" block :disabled="!canRun || runs.loading" @click="run">
        <template v-if="runs.progress">
          <v-progress-circular indeterminate size="14" width="2" class="mr-2" />
          {{ t('propagate.progress', runs.progress) }}
        </template>
        <template v-else>
          <Play :size="15" class="mr-2" aria-hidden="true" />{{ t('propagate.run') }}
        </template>
      </v-btn>
    </div>
    <StaleEpochDialog :targets="staleTargets" @confirm="confirmStale" @cancel="staleTargets = []" />
  </DashboardCard>
</template>

<script setup lang="ts">
import { ChevronDown, Clock, FileClock, FlaskConical, History, Orbit, Play } from 'lucide-vue-next'
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { farthestDays, worstLevel } from '../orbit/epochTrust'
import {
  HPOP_MAX_EPOCH_GAP_DAYS,
  defaultHpopForm,
  effectivePropagator,
  hpopFormValid,
  hpopRequest,
  hpopWindowProblem,
  overlapsSpan,
  propagatorLabel,
  type Propagator,
} from '../orbit/propagatorOptions'
import { useClockStore } from '../stores/clock'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useUiStore } from '../stores/ui'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { customKind, hasElements, sameSatellite } from '../utils/satelliteRef'
import { formatUtc, fromUtcInput, toUtcInput } from '../utils/time'
import CollapsibleSection from './CollapsibleSection.vue'
import DashboardCard from './DashboardCard.vue'
import HpopOptionsForm from './HpopOptionsForm.vue'
import StaleEpochDialog, { type StaleTarget } from './StaleEpochDialog.vue'

const MAX_SAMPLES = 100_000
const HOUR_S = 3600

const basket = useSatelliteBasketStore()
const runs = useRunsStore()
const { t } = useI18n()
const clock = useClockStore()
const ui = useUiStore()
const theme = useThemePreset()

/**
 * The picked satellites, each with the colour its run will get: a satellite that already has
 * a run keeps that run's colour, a new one takes the next free colour in line.
 */
const targets = computed(() => {
  let next = runs.runs.length
  return basket.items.map((item) => {
    const detail = basket.detailOf(item.ref)
    const existing = runs.runs.find((run) => sameSatellite(run, item.ref))
    const colorIndex = existing?.colorIndex ?? next++
    const kind = customKind(item.ref)
    const minutes = detail?.orbit.period_min.toFixed(1)
    return {
      key: item.key,
      ref: item.ref,
      kind,
      name: detail?.name ?? item.name,
      periodMin: detail?.orbit.period_min ?? null,
      color: orbitColorHex(colorIndex, theme.preset.globe.orbitPalette),
      propagator: effectivePropagator(kind, propagator.value),
      summary: !detail
        ? t('catalog.loading')
        : kind === 'state'
          ? `${t('catalog.userState')} · ${t('propagate.periodOnly', { minutes })}`
          : kind === 'ephemeris'
            ? `${t('catalog.userEphemeris')} · ${spanLabel(detail)}`
            : t('propagate.periodSummary', { norad: detail.norad_id, minutes }),
    }
  })
})
/** "One orbit" covers the slowest picked satellite, so every run shows a full revolution. */
const longestPeriodMin = computed(() =>
  Math.max(90, ...targets.value.map((target) => target.periodMin ?? 0)),
)
const startInput = ref(toUtcInput(Date.now()))
const durationKey = ref('1d')
const stepS = ref(30)
const propagator = ref<Propagator>('sgp4')
/** Whether the propagator choice is unfolded; it starts folded every time. */
const advanced = ref(false)
const hpopForm = ref(defaultHpopForm())
const lastRun = shallowRef<OrbitRun | null>(null)

const durationOptions = computed(() => [
  { key: 'orbit', seconds: longestPeriodMin.value * 60 },
  { key: '6h', seconds: 6 * HOUR_S },
  { key: '1d', seconds: 24 * HOUR_S },
  { key: '3d', seconds: 72 * HOUR_S },
  { key: '7d', seconds: 168 * HOUR_S },
])
const stepOptions = computed(() => [
  { title: t('propagate.steps.s10'), value: 10 },
  { title: t('propagate.steps.s30'), value: 30 },
  { title: t('propagate.steps.m1'), value: 60 },
  { title: t('propagate.steps.m2'), value: 120 },
])

const startMs = computed(() => fromUtcInput(startInput.value))
const durationS = computed(
  () => durationOptions.value.find((option) => option.key === durationKey.value)?.seconds ?? 0,
)
const endMs = computed(() => startMs.value + durationS.value * 1000)
const sampleCount = computed(() => Math.floor(durationS.value / stepS.value) + 1)
const endLabel = computed(() => (Number.isNaN(endMs.value) ? '—' : formatUtc(endMs.value, false)))
const hpopSummary = computed(() => {
  const form = hpopForm.value
  const forces = [
    form.gravityDegree === 2
      ? t('propagate.hpop.j2')
      : `${form.gravityDegree}×${form.gravityDegree}`,
    form.thirdBody && t('propagate.hpop.thirdBody'),
    form.drag && t('propagate.hpop.drag'),
    form.srp && t('propagate.hpop.srp'),
  ]
  return forces.filter(Boolean).join(' · ')
})
const usesHpop = computed(() => targets.value.some((target) => target.propagator === 'hpop'))
/** HPOP started from mean elements, which is what the accuracy caveat is about. */
const hpopFromElements = computed(() =>
  targets.value.some((target) => target.propagator === 'hpop' && target.kind !== 'state'),
)
const eyebrow = computed(() => {
  const used = new Set(targets.value.map((target) => target.propagator))
  return propagatorLabel(used.size === 1 ? [...used][0]! : propagator.value)
})
/** Spans of the picked ephemerides; nothing outside them can be sampled. */
const fileSpans = computed(() =>
  targets.value.flatMap((target) => {
    const detail = basket.detailOf(target.ref)
    if (target.kind !== 'ephemeris' || !detail?.span_start || !detail.span_end) return []
    return [
      {
        name: detail.name,
        startMs: Date.parse(detail.span_start),
        endMs: Date.parse(detail.span_end),
      },
    ]
  }),
)
const fileSpanStartMs = computed(() => fileSpans.value[0]?.startMs ?? null)
const outsideSpan = computed(() =>
  Number.isNaN(startMs.value)
    ? []
    : fileSpans.value
        .filter((span) => !overlapsSpan(startMs.value, endMs.value, span.startMs, span.endMs))
        .map((span) => span.name),
)
/** Picked satellites HPOP would refuse: it integrates from the epoch, which is too far away. */
const hpopBlocked = computed(() => {
  if (Number.isNaN(startMs.value)) return []
  return targets.value.flatMap((target) => {
    const detail = basket.detailOf(target.ref)
    if (!detail || target.propagator !== 'hpop') return []
    const problem = hpopWindowProblem(Date.parse(detail.epoch), startMs.value, endMs.value)
    return problem === 'epoch' ? [detail.name] : []
  })
})
const canRun = computed(
  () =>
    targets.value.length > 0 &&
    !Number.isNaN(startMs.value) &&
    sampleCount.value <= MAX_SAMPLES &&
    !hpopBlocked.value.length &&
    !outsideSpan.value.length &&
    (!usesHpop.value || hpopFormValid(hpopForm.value)),
)

function spanLabel(detail: { span_start?: string; span_end?: string }): string {
  if (!detail.span_start || !detail.span_end) return ''
  const start = formatUtc(Date.parse(detail.span_start), false)
  return `${start} – ${formatUtc(Date.parse(detail.span_end), false)} UTC`
}

function setStart(ms: number) {
  startInput.value = toUtcInput(ms)
}

/** Picked satellites whose window reaches the "poor" grade (over 14 days from the epoch). */
function farFromEpoch(): StaleTarget[] {
  return basket.items.flatMap((item) => {
    const detail = basket.detailOf(item.ref)
    // The grades are about mean elements ageing; a state vector is not graded.
    if (!detail || !hasElements(item.ref)) return []
    const epochMs = Date.parse(detail.epoch)
    const level = worstLevel(epochMs, startMs.value, endMs.value)
    if (level !== 'poor') return []
    const days = farthestDays(epochMs, startMs.value, endMs.value)
    return [{ key: item.key, name: detail.name, epochMs, days, level }]
  })
}

const staleTargets = shallowRef<StaleTarget[]>([])

function confirmStale() {
  staleTargets.value = []
  void propagate()
}

function run() {
  if (!canRun.value) return
  const stale = farFromEpoch()
  if (stale.length) staleTargets.value = stale
  else void propagate()
}

async function propagate() {
  const made = await runs.propagateMany(
    targets.value.map((target) => ({
      ...target.ref,
      name: target.name,
      startMs: startMs.value,
      endMs: endMs.value,
      stepS: stepS.value,
      propagator: target.propagator,
      hpop: target.propagator === 'hpop' ? hpopRequest(hpopForm.value) : null,
    })),
  )
  lastRun.value = made[0] ?? null
  // The runs are on the globe; the next page lists them. Failures stay here to be read.
  if (made.length && !runs.failures.length) ui.openSatelliteStep('runs')
}
</script>

<style scoped>
.targets {
  display: grid;
  gap: var(--space-2);
}
.targets .section-label {
  margin: 0;
}
.failures-title {
  margin: 0 0 2px;
  font-weight: 650;
}
.failures {
  margin: 0;
  padding-left: 16px;
}
.target {
  display: flex;
  align-items: center;
  gap: 10px;
}
.target strong {
  display: block;
  font-size: 14px;
}
.target small {
  font-size: 11.5px;
}
.start {
  display: grid;
  gap: 6px;
}
.start-picks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.step-toggle {
  margin-top: var(--space-2);
}
.advanced__head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.advanced__chevron {
  transform: rotate(-90deg);
  transition: transform 0.15s;
}
.advanced__chevron--open {
  transform: none;
}
.advanced__summary {
  margin-left: auto;
  font-weight: 600;
}
.advanced__body {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.advanced__body .section-label {
  margin: 0;
}
.hpop-warning {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.hpop-warning + .hpop-warning {
  margin-top: var(--space-1);
}
.estimate {
  margin: calc(var(--space-2) - var(--stack-gap)) 0 0;
  font-variant-numeric: tabular-nums;
}
</style>
