<template>
  <v-dialog
    :model-value="entry !== null"
    max-width="720"
    aria-labelledby="pass-detail-title"
    @update:model-value="(open: boolean) => open || emit('close')"
  >
    <v-card
      v-if="entry"
      class="glass"
      elevation="0"
      rounded="lg"
      border
      data-testid="pass-detail-dialog"
    >
      <v-card-text class="form-stack">
        <div class="label-row">
          <i class="swatch" :style="{ background: color }" aria-hidden="true" />
          <div class="grow">
            <p id="pass-detail-title" class="eyebrow">{{ title }}</p>
            <strong class="when">{{ span.aos }} → {{ span.los }} UTC</strong>
          </div>
          <InfoTip :label="t('passes.detail.assumptions.label')">
            <ul class="tip-list">
              <li>{{ t('passes.detail.assumptions.sampled') }}</li>
              <li>{{ t('passes.detail.assumptions.geometric') }}</li>
              <li>{{ t('passes.detail.assumptions.doppler') }}</li>
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

        <div v-if="!samples.length" class="empty-hint">{{ t('passes.detail.noTrack') }}</div>
        <div v-else class="body">
          <SkyPlot
            :label="t('passes.detail.sky')"
            :samples="samples"
            :color="color"
            :min-elev-deg="entry.station.min_elev_deg"
            :mask="entry.station.az_mask"
            :mark-labels="[t('passes.aos'), 'TCA', t('passes.los')]"
            :now="now"
          />
          <div class="form-stack">
            <div class="stat-grid" data-testid="pass-detail-stats">
              <div v-for="stat in stats" :key="stat.id" class="stat">
                <span>{{ t(`passes.detail.stats.${stat.id}`) }}</span
                ><strong>{{ stat.value }}</strong
                ><small>{{ stat.unit }}</small>
              </div>
            </div>
            <v-btn-toggle
              v-model="curve"
              mandatory
              class="segmented"
              :aria-label="t('passes.detail.curve.label')"
            >
              <v-btn v-for="kind in CURVES" :key="kind" :value="kind">
                {{ t(`passes.detail.curve.${kind}`) }}
              </v-btn>
            </v-btn-toggle>
            <LevelChart
              :label="t('passes.detail.chart', { curve: t(`passes.detail.curve.${curve}`) })"
              :points="chart.points"
              :min="chart.min"
              :max="chart.max"
              :start-ms="aosMs"
              :end-ms="losMs"
              :alerts="[]"
              :now-ms="clock.currentMs"
              @seek="seek"
            />
            <p class="muted text-caption scale" data-testid="pass-detail-scale">
              {{ t('passes.detail.scale', chart.scale) }}
            </p>
            <v-text-field
              v-model.number="passes.carrierMhz"
              type="number"
              min="1"
              :label="t('passes.detail.carrier')"
              data-testid="pass-detail-carrier"
            />
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { interpolateTrack } from '../globe/passTrack'
import { useLocaleStore } from '../i18n/useLocale'
import { stationFrame } from '../mission/linkWindow'
import { dopplerHz, lookAngles, passSamples } from '../orbit/passGeometry'
import { useClockStore } from '../stores/clock'
import { passKey, usePassesStore, type TimelineEntry } from '../stores/passes'
import { useRunsStore } from '../stores/runs'
import { stationLabel } from '../stations/presets'
import type { LevelPoint } from '../utils/levelChart'
import { passSpan } from '../utils/passTimeline'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import { usePassColors } from '../utils/usePassColors'
import InfoTip from './InfoTip.vue'
import LevelChart from './LevelChart.vue'
import SkyPlot from './SkyPlot.vue'

const CURVES = ['elevation', 'range', 'rate'] as const
type Curve = (typeof CURVES)[number]

/**
 * One pass seen from its station: its path across the sky and how elevation, range and
 * range rate run from AOS to LOS. Everything is read off the pass's track, so opening it
 * asks the server nothing.
 */
const props = defineProps<{ entry: TimelineEntry | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const locale = useLocaleStore()
const passes = usePassesStore()
const runs = useRunsStore()
const clock = useClockStore()
const { passColor } = usePassColors()
const curve = ref<Curve>('elevation')

const aosMs = computed(() => (props.entry ? Date.parse(props.entry.pass.aos) : 0))
const losMs = computed(() => (props.entry ? Date.parse(props.entry.pass.los) : 0))
const span = computed(() => passSpan(aosMs.value, losMs.value))
const color = computed(() => (props.entry ? passColor(props.entry) : ''))

const title = computed(() => {
  const entry = props.entry
  if (!entry) return ''
  const text = t('passes.detail.title', {
    n: passes.numberOf(passKey(entry.pass)),
    station: stationLabel(entry.station, locale.locale),
  })
  return passes.multi ? `${text} · ${passes.satelliteName(entry.pass.satellite_index)}` : text
})

const samples = computed(() => {
  const entry = props.entry
  if (!entry) return []
  const contact = { aosMs: aosMs.value, losMs: losMs.value, track: entry.pass.track_fixed_m }
  return passSamples(contact, entry.station)
})

/** Where the satellite is in this station's sky at the clock's time. */
const now = computed(() => {
  const entry = props.entry
  if (!entry) return null
  const at = interpolateTrack(entry.pass.track_fixed_m, aosMs.value, losMs.value, clock.currentMs)
  return at ? lookAngles(stationFrame(entry.station), ...at) : null
})

const peaks = computed(() => {
  const ranges = samples.value.map((sample) => sample.rangeKm)
  const rates = samples.value.map((sample) => Math.abs(sample.rangeRateKmS))
  return {
    minRange: Math.min(...ranges),
    maxRange: Math.max(...ranges),
    maxRate: Math.max(...rates),
  }
})

const stats = computed(() => {
  const entry = props.entry
  if (!entry || !samples.value.length) return []
  const carrierHz = passes.carrierMhz * 1e6
  const doppler = carrierHz > 0 ? Math.abs(dopplerHz(peaks.value.maxRate, carrierHz)) / 1000 : null
  return [
    { id: 'maxElevation', value: entry.pass.max_elevation_deg.toFixed(1), unit: '°' },
    { id: 'minRange', value: peaks.value.minRange.toFixed(0), unit: 'km' },
    { id: 'maxRate', value: peaks.value.maxRate.toFixed(2), unit: 'km/s' },
    { id: 'maxDoppler', value: doppler === null ? '–' : `±${doppler.toFixed(1)}`, unit: 'kHz' },
  ]
})

/** The charted curve with the value range it is drawn against. */
const chart = computed(() => {
  const points = (value: (i: number) => number): LevelPoint[] =>
    samples.value.map((sample, i) => ({ ms: sample.ms, value: value(i) }))
  const of = (values: LevelPoint[], min: number, max: number, unit: string, digits: number) => ({
    points: values,
    min,
    max,
    scale: { low: min.toFixed(digits), high: max.toFixed(digits), unit },
  })
  if (curve.value === 'range') {
    const low = Math.floor(peaks.value.minRange / 100) * 100
    const high = Math.max(Math.ceil(peaks.value.maxRange / 100) * 100, low + 100)
    return of(
      points((i) => samples.value[i]!.rangeKm),
      low,
      high,
      'km',
      0,
    )
  }
  if (curve.value === 'rate') {
    const reach = Math.max(Math.ceil(peaks.value.maxRate), 1)
    return of(
      points((i) => samples.value[i]!.rangeRateKmS),
      -reach,
      reach,
      'km/s',
      0,
    )
  }
  return of(
    points((i) => samples.value[i]!.elevationDeg),
    0,
    90,
    '°',
    0,
  )
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
.when {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
.scale {
  margin: calc(var(--space-1) - var(--stack-gap)) 0 0;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 640px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
