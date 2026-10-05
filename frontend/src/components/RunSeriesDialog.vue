<template>
  <v-dialog
    :model-value="run !== null"
    max-width="560"
    aria-labelledby="run-series-title"
    @update:model-value="(open: boolean) => open || emit('close')"
  >
    <v-card
      v-if="run"
      class="glass"
      elevation="0"
      rounded="lg"
      border
      data-testid="run-series-dialog"
    >
      <v-card-text class="form-stack">
        <div class="label-row">
          <i class="color-dot" :style="{ background: color }" aria-hidden="true" />
          <div class="grow">
            <p id="run-series-title" class="eyebrow">{{ t('propagate.runs.series.title') }}</p>
            <strong class="name">{{ run.name }}</strong>
          </div>
          <InfoTip :label="t('propagate.runs.series.notes.label')">
            <ul class="tip-list">
              <li>{{ t('propagate.runs.series.notes.altitude') }}</li>
              <li>{{ t('propagate.runs.series.notes.beta') }}</li>
              <li>{{ t('propagate.runs.series.notes.eclipse') }}</li>
            </ul>
          </InfoTip>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <X :size="15" />
          </v-btn>
        </div>

        <v-btn-toggle
          v-model="curve"
          mandatory
          class="segmented"
          :aria-label="t('propagate.runs.series.curve.label')"
        >
          <v-btn v-for="kind in CURVES" :key="kind" :value="kind">
            {{ t(`propagate.runs.series.curve.${kind}`) }}
          </v-btn>
        </v-btn-toggle>

        <div v-if="!chart" class="empty-hint" data-testid="run-series-empty">
          {{ t('propagate.runs.series.noBeta') }}
        </div>
        <template v-else>
          <div class="stat-grid stats" data-testid="run-series-stats">
            <div v-for="stat in chart.stats" :key="stat.id" class="stat">
              <span>{{ t(`propagate.runs.series.stats.${stat.id}`) }}</span
              ><strong>{{ stat.value }}</strong
              ><small>{{ chart.unit }}</small>
            </div>
          </div>
          <LevelChart
            :label="
              t('propagate.runs.series.chart', { curve: t(`propagate.runs.series.curve.${curve}`) })
            "
            :points="chart.points"
            :min="chart.min"
            :max="chart.max"
            :start-ms="run.startMs"
            :end-ms="run.stopMs"
            :alerts="[]"
            :shades="shades"
            :now-ms="clock.currentMs"
            @seek="seek"
          />
          <p class="muted text-caption scale">
            {{
              t('propagate.runs.series.scale', {
                low: chart.min.toFixed(0),
                high: chart.max.toFixed(0),
                unit: chart.unit,
              })
            }}
          </p>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { eclipseIntervals } from '../orbit/eclipse'
import { useClockStore } from '../stores/clock'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { thinExtremes, type LevelPoint, type TimeSpan } from '../utils/levelChart'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import InfoTip from './InfoTip.vue'
import LevelChart from './LevelChart.vue'

const CURVES = ['altitude', 'beta'] as const
type Curve = (typeof CURVES)[number]
/** Vertices the chart draws at most; a 30 day run has tens of thousands of samples. */
const MAX_CHART_POINTS = 1200

/** Altitude and beta angle of one propagated run across its whole span. */
const props = defineProps<{ run: OrbitRun | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const clock = useClockStore()
const runs = useRunsStore()
const theme = useThemePreset()
const curve = ref<Curve>('altitude')

const color = computed(() =>
  props.run ? orbitColorHex(props.run.colorIndex, theme.preset.globe.orbitPalette) : '',
)

const altitude = computed<LevelPoint[]>(() => {
  const run = props.run
  if (!run) return []
  const invalid = new Set(run.data.invalid)
  const stepMs = run.data.step_s * 1000
  return run.data.alt_km.flatMap((value, i) =>
    invalid.has(i) ? [] : [{ ms: run.startMs + i * stepMs, value }],
  )
})

/** Null for a run stored before the server sent the series, or one made without DE421. */
const beta = computed<LevelPoint[] | null>(() => {
  const run = props.run
  const offsets = run?.data.beta_offset_s
  const values = run?.data.beta_deg
  if (!run || !offsets || !values || offsets.length !== values.length) return null
  return values.map((value, i) => ({ ms: run.startMs + offsets[i]! * 1000, value }))
})

/** Value of a series at the clock's time, taken from its nearest point; null outside the run. */
function valueNow(points: readonly LevelPoint[]): number | null {
  const run = props.run
  const ms = clock.currentMs
  if (!run || !points.length || ms < run.startMs || ms > run.stopMs) return null
  return points.reduce((best, point) =>
    Math.abs(point.ms - ms) < Math.abs(best.ms - ms) ? point : best,
  ).value
}

const chart = computed(() => {
  const isBeta = curve.value === 'beta'
  const points = isBeta ? beta.value : altitude.value
  if (!points?.length) return null
  const values = points.map((point) => point.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const digits = isBeta ? 2 : 1
  const now = valueNow(points)
  // Beta is drawn against a whole number of degrees, altitude against tens of kilometres.
  const grain = isBeta ? 1 : 10
  const min = Math.floor(low / grain) * grain
  return {
    points: thinExtremes(points, MAX_CHART_POINTS),
    min,
    max: Math.max(Math.ceil(high / grain) * grain, min + grain),
    unit: isBeta ? '°' : 'km',
    stats: [
      { id: 'min', value: low.toFixed(digits) },
      { id: 'max', value: high.toFixed(digits) },
      { id: 'now', value: now === null ? '–' : now.toFixed(digits) },
    ],
  }
})

const shades = computed<TimeSpan[]>(() => {
  const run = props.run
  const seconds = run ? eclipseIntervals(run.data) : null
  if (!run || !seconds) return []
  const spans: TimeSpan[] = []
  for (let i = 0; i + 1 < seconds.length; i += 2) {
    spans.push({
      startMs: run.startMs + seconds[i]! * 1000,
      endMs: run.startMs + seconds[i + 1]! * 1000,
    })
  }
  return spans
})

function seek(ms: number) {
  revealWithinRuns(clock, runs.runs, ms)
}
</script>

<style scoped>
.label-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.label-row .eyebrow {
  margin: 0;
}
.grow {
  flex: 1;
  min-width: 0;
}
.name {
  display: block;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.scale {
  margin: calc(var(--space-1) - var(--stack-gap)) 0 0;
  font-variant-numeric: tabular-nums;
}
</style>
