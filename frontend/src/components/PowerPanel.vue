<template>
  <div class="form-stack" data-testid="mission-power">
    <div v-if="!run" class="empty-hint">
      {{ t('missionPower.needRun') }}
      <br />
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        class="mt-2"
        @click="ui.openSatelliteStep(basket.focus ? 'propagate' : 'pick')"
      >
        {{ t('missionPower.toPropagate') }}
      </v-btn>
    </div>
    <template v-else>
      <div class="head">
        <RunSelect
          class="target"
          :runs="runs.runs"
          :model-value="run.id"
          :label="t('mission.target')"
          test-id="target-run-select"
          @update:model-value="runs.select"
        >
          <template #subtitle>
            {{
              t('missionPower.sources', {
                shots: power.shots.length,
                contacts: power.contacts.length,
              })
            }}
          </template>
        </RunSelect>
        <div class="chips" data-testid="power-chips">
          <v-chip size="x-small" variant="tonal" :title="t('missionPower.attitude.label')">
            <component
              :is="ATTITUDE_ICONS[settings.contactAttitude]"
              :size="12"
              class="mr-1"
              aria-hidden="true"
            />{{ t(`missionPower.attitude.${settings.contactAttitude}`) }}
          </v-chip>
          <v-chip size="x-small" variant="tonal" :title="t('missionPower.battery.kind.label')">
            {{ t(`missionPower.battery.kind.${settings.batteryKind}`) }}
          </v-chip>
        </div>
        <div v-if="notices.length" class="chips" data-testid="power-notices">
          <v-chip
            v-for="notice in notices"
            :key="notice.id"
            size="x-small"
            variant="tonal"
            color="warning"
            :title="t(`missionPower.notice.${notice.id}Hint`)"
            :data-testid="`power-${notice.id}`"
            @click="ui.openTool(notice.tool)"
          >
            <TriangleAlert :size="12" class="mr-1" aria-hidden="true" />{{
              t(`missionPower.notice.${notice.id}`)
            }}
          </v-chip>
        </div>
      </div>

      <v-alert v-if="power.error" type="error" variant="tonal" density="compact">
        {{ apiErrorText(power.error, t) }}
      </v-alert>
      <div class="start">
        <v-text-field
          v-model.number="settings.initialSocPct"
          class="start-soc"
          type="number"
          :min="POWER_LIMITS.initialSocPct[0]"
          :max="POWER_LIMITS.initialSocPct[1]"
          :label="t('missionPower.fields.initialSocPct')"
        />
        <v-chip
          size="small"
          variant="tonal"
          data-testid="power-soc-run-start"
          @click="power.setSocAt(null)"
        >
          <SkipBack :size="13" class="mr-1" aria-hidden="true" />{{ t('missionPower.useRunStart') }}
        </v-chip>
        <v-chip
          size="small"
          variant="tonal"
          data-testid="power-soc-timeline"
          @click="power.setSocAt(clock.currentMs)"
        >
          <History :size="13" class="mr-1" aria-hidden="true" />{{ t('missionPower.useTimeline') }}
        </v-chip>
      </div>
      <v-text-field
        :model-value="socAtInput"
        type="datetime-local"
        step="1"
        :label="t('missionPower.socAt')"
        data-testid="power-soc-at"
        @update:model-value="pickSocAt"
      />

      <template v-if="result">
        <v-alert
          v-for="warning in warningTexts(result.warnings, t)"
          :key="warning"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ warning }}
        </v-alert>
        <div class="stat-grid" data-testid="power-stats">
          <div
            v-for="stat in stats"
            :key="stat.id"
            class="stat"
            :class="stat.level ? `stat--${stat.level}` : undefined"
            :data-level="stat.level ?? undefined"
          >
            <span>{{ t(`missionPower.stats.${stat.id}`) }}</span
            ><strong>{{ stat.value }}</strong
            ><small>{{ stat.unit }}</small>
          </div>
        </div>
        <v-alert
          v-if="result.unmet_wh > 0"
          type="error"
          variant="tonal"
          density="compact"
          data-testid="power-empty"
        >
          {{ t('missionPower.empty', { wh: wh(result.unmet_wh) }) }}
        </v-alert>

        <v-btn-toggle
          v-if="result.model === 'circuit'"
          v-model="series"
          class="segmented"
          mandatory
          :aria-label="t('missionPower.series.label')"
          data-testid="power-series"
        >
          <v-btn v-for="item in SERIES" :key="item" :value="item">
            {{ t(`missionPower.series.${item}`) }}
          </v-btn>
        </v-btn-toggle>
        <LevelChart
          data-testid="power-chart"
          :class="{ stale: power.loading }"
          :label="t('missionPower.chart')"
          :points="chart.points"
          :min="chart.min"
          :max="chart.max"
          :line="chart.line"
          :start-ms="run.startMs"
          :end-ms="run.stopMs"
          :alerts="chart.alerts"
          :shades="eclipseSpans"
          :now-ms="clock.currentMs"
          @seek="(ms) => clock.reveal(Math.min(Math.max(ms, run!.startMs), run!.stopMs))"
        />
        <p v-if="chart.caption" class="muted text-caption field-note" data-testid="power-range">
          {{ chart.caption }}
        </p>
      </template>
      <v-progress-linear v-else-if="power.loading" indeterminate color="primary" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { History, SkipBack, TriangleAlert } from 'lucide-vue-next'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText, warningTexts } from '../api/messages'
import {
  levelAt,
  POWER_LIMITS,
  powerPoints,
  powerStatLevels,
  seriesPoints,
  spansMs,
  type StatLevel,
} from '../mission/power'
import { useClockStore } from '../stores/clock'
import { useMissionStore } from '../stores/mission'
import { usePowerStore } from '../stores/power'
import { useRunsStore } from '../stores/runs'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useUiStore, type ToolId } from '../stores/ui'
import { formatUtc, fromUtcInput } from '../utils/time'
import LevelChart from './LevelChart.vue'
import { ATTITUDE_ICONS } from './powerAttitudeIcons'
import RunSelect from './RunSelect.vue'

/** Wait for typing to pause before asking the server again. */
const DEBOUNCE_MS = 400

/**
 * Battery state of charge for the run the power store follows. The server recomputes it
 * whenever the run, its planned activities or these settings change.
 */
const { t } = useI18n()
const mission = useMissionStore()
const power = usePowerStore()
const runs = useRunsStore()
const clock = useClockStore()
const basket = useSatelliteBasketStore()
const ui = useUiStore()
const settings = mission.saved.power

const run = computed(() => power.run)
const result = computed(() => power.result)

/** Inputs that are missing or out of date, each with the tool that fixes it. */
const notices = computed(() => {
  const { noPlan, noShots, stale } = power.notices
  const list: { id: 'noPlan' | 'noShots' | 'stale'; tool: ToolId }[] = []
  if (noPlan) list.push({ id: 'noPlan', tool: 'passes' })
  if (noShots) list.push({ id: 'noShots', tool: 'imaging' })
  if (stale) list.push({ id: 'stale', tool: 'imaging' })
  return list
})

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => power.request,
  (request, previous) => {
    clearTimeout(timer)
    if (!request) return
    // The first request of a run has nothing on screen to keep, so it goes straight away.
    timer = setTimeout(() => void power.compute(), previous && power.result ? DEBOUNCE_MS : 0)
  },
  { immediate: true },
)
onScopeDispose(() => clearTimeout(timer))

/** The start of the simulation as a `datetime-local` value read as UTC, to the second. */
const socAtInput = computed(() =>
  power.socAtMs === null ? '' : formatUtc(power.socAtMs).replace(' ', 'T'),
)

function pickSocAt(value: string) {
  const ms = fromUtcInput(value)
  if (Number.isFinite(ms)) power.setSocAt(ms)
}

const points = computed(() => (result.value ? powerPoints(result.value) : []))
const limitSpans = computed(() =>
  result.value ? spansMs(result.value.below_limit_s, result.value.start) : [],
)
const eclipseSpans = computed(() =>
  result.value ? spansMs(result.value.eclipse_s, result.value.start) : [],
)
const limitPct = computed(() => settings.dodLimitPct)

/** What the one chart draws; voltage and current exist only for the equivalent circuit. */
const SERIES = ['soc', 'voltage', 'current'] as const
const series = ref<(typeof SERIES)[number]>('soc')
const padded = (low: number, high: number) => {
  const pad = Math.max((high - low) * 0.1, 0.05)
  return { min: low - pad, max: high + pad }
}
const chart = computed(() => {
  const data = result.value
  const unserved = data ? spansMs(data.empty_s, data.start) : []
  if (data?.model === 'circuit' && series.value === 'voltage' && data.voltage_v) {
    const low = data.min_voltage_v ?? 0
    const high = data.max_voltage_v ?? 0
    return {
      points: seriesPoints(data, data.voltage_v),
      ...padded(low, high),
      line: undefined,
      alerts: unserved,
      caption: t('missionPower.range.voltage', { min: low.toFixed(2), max: high.toFixed(2) }),
    }
  }
  if (data?.model === 'circuit' && series.value === 'current' && data.current_a) {
    const charge = data.max_charge_a ?? 0
    const discharge = data.max_discharge_a ?? 0
    return {
      points: seriesPoints(data, data.current_a),
      ...padded(-charge, discharge),
      line: 0,
      alerts: unserved,
      caption: t('missionPower.range.current', {
        discharge: discharge.toFixed(1),
        charge: charge.toFixed(1),
        loss: wh(data.loss_wh ?? 0),
      }),
    }
  }
  return {
    points: points.value,
    min: 0,
    max: 1.08,
    line: 1 - limitPct.value / 100,
    alerts: limitSpans.value,
    caption: '',
  }
})

const wh = (value: number) => value.toFixed(value >= 100 ? 0 : 1)
const percent = (fraction: number) => (fraction * 100).toFixed(1)
const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(1)}`
const degrees = (value: number | null) => (value === null ? '–' : value.toFixed(1))

const stats = computed(() => {
  const data = result.value
  if (!data) return []
  const beta =
    degrees(data.beta_start_deg) === degrees(data.beta_end_deg)
      ? degrees(data.beta_start_deg)
      : `${degrees(data.beta_start_deg)} → ${degrees(data.beta_end_deg)}`
  const drift = (data.final_soc - (data.soc[0] ?? 0)) * 100
  const now = levelAt(points.value, clock.currentMs)
  const levels = powerStatLevels(data, limitPct.value, now)
  const stat = (id: string, value: string, unit: string, level: StatLevel = null) => ({
    id,
    value,
    unit,
    level,
  })
  return [
    stat('minSoc', percent(data.min_soc), '%', levels.depth),
    stat('maxDod', percent(data.max_dod), '%', levels.depth),
    stat('finalSoc', percent(data.final_soc), `% (${signed(drift)})`, levels.final),
    stat('nowSoc', now === null ? '–' : percent(now), '%', levels.now),
    stat('generated', wh(data.generated_wh), 'Wh'),
    stat('consumed', wh(data.consumed_wh), 'Wh'),
    stat('eclipse', percent(data.eclipse_fraction), '%'),
    stat('beta', beta, '°'),
  ]
})
</script>

<style scoped>
/* The settings in force sit beside the satellite, since the form itself is in a popover. */
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
}
.target {
  flex: 1 1 160px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.start {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.start-soc {
  flex: 0 0 112px;
}
.stale {
  opacity: 0.6;
}
</style>
