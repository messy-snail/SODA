<template>
  <div class="form-stack" data-testid="mission-coverage">
    <PlannedRunsNote />
    <PointingChips />

    <AoiTargetList kind="box" />

    <div v-if="!coverage.boxes.length" class="empty-hint" data-testid="coverage-need-box">
      {{ t('missionCoverage.needBox') }}
    </div>
    <template v-else>
      <v-select
        v-if="coverage.boxes.length > 1"
        :model-value="coverage.target?.id"
        :items="coverage.boxes"
        item-title="name"
        item-value="id"
        :label="t('missionCoverage.area')"
        data-testid="coverage-area"
        @update:model-value="(id: string) => (coverage.settings.targetId = id)"
      />
      <v-btn-toggle
        v-model="coverage.settings.resolution"
        class="segmented"
        mandatory
        :aria-label="t('missionCoverage.resolution.label')"
      >
        <v-btn v-for="id in RESOLUTION_IDS" :key="id" :value="id">
          {{ t(`missionCoverage.resolution.${id}`) }}
        </v-btn>
      </v-btn-toggle>
      <p class="muted text-caption under" data-testid="coverage-shape">
        {{ t('missionCoverage.shape', shape) }}
      </p>
    </template>
    <v-btn
      color="primary"
      block
      :disabled="!coverage.target || !mission.planned.length || !mission.pointingValid"
      :loading="coverage.loading"
      data-testid="coverage-compute"
      @click="coverage.compute()"
    >
      <Grid3x3 :size="15" class="mr-2" aria-hidden="true" />{{ t('missionCoverage.compute') }}
    </v-btn>
    <template v-if="coverage.boxes.length">
      <v-alert v-if="coverage.error" type="error" variant="tonal" density="compact">
        {{ apiErrorText(coverage.error, t) }}
      </v-alert>
      <p
        v-if="coverage.progress && coverage.progress.total > 1"
        class="muted text-caption"
        data-testid="coverage-progress"
      >
        {{ t('missionCoverage.progress', coverage.progress) }}
      </p>

      <template v-if="coverage.result">
        <p v-if="coverage.stale" class="muted text-caption" data-testid="coverage-stale">
          {{ t('missionCoverage.stale') }}
        </p>
        <div v-if="satellites.length > 1" class="chips" data-testid="coverage-filter">
          <v-chip
            size="small"
            :variant="coverage.satelliteFilter === null ? 'tonal' : 'outlined'"
            :color="coverage.satelliteFilter === null ? 'primary' : undefined"
            :aria-pressed="coverage.satelliteFilter === null"
            @click="coverage.satelliteFilter = null"
          >
            {{ t('missionCoverage.all', { count: satellites.length }) }}
          </v-chip>
          <v-chip
            v-for="satellite in satellites"
            :key="satellite.key"
            size="small"
            :variant="coverage.satelliteFilter === satellite.key ? 'tonal' : 'outlined'"
            :aria-pressed="coverage.satelliteFilter === satellite.key"
            :title="t('missionCoverage.filter', { satellite: satellite.name })"
            @click="
              coverage.satelliteFilter =
                coverage.satelliteFilter === satellite.key ? null : satellite.key
            "
          >
            <i class="dot" :style="{ background: satellite.color }" aria-hidden="true" />
            {{ satellite.name }}
          </v-chip>
        </div>
        <div v-if="!coverage.window" class="empty-hint" data-testid="coverage-no-window">
          {{ t('missionCoverage.noCommonWindow') }}
        </div>
        <template v-else>
          <v-btn-toggle
            v-model="coverage.settings.metric"
            class="segmented metrics"
            mandatory
            :aria-label="t('missionCoverage.metric.label')"
            data-testid="coverage-metric"
          >
            <v-btn v-for="metric in METRICS" :key="metric" :value="metric">
              {{ t(`missionCoverage.metric.${metric}`) }}
            </v-btn>
          </v-btn-toggle>
          <CoverageLegend
            :label="
              t('missionCoverage.legend.label', {
                metric: t(`missionCoverage.metric.${coverage.settings.metric}`),
              })
            "
            :low="legend.low"
            :high="legend.high"
            :empty-label="t('missionCoverage.legend.empty')"
          />
          <div class="stat-grid" data-testid="coverage-stats">
            <div
              v-for="stat in stats"
              :key="stat.id"
              class="stat"
              :class="stat.warn ? 'stat--warning' : undefined"
              :title="stat.title"
            >
              <span>{{ t(`missionCoverage.stats.${stat.id}`) }}</span
              ><strong>{{ stat.value }}</strong>
            </div>
          </div>
          <div class="cell" data-testid="coverage-cell">
            <template v-if="cell">
              <span class="grow">
                <strong>{{ t('missionCoverage.cell.title', cell.place) }}</strong>
                <small>{{ t('missionCoverage.cell.values', cell.values) }}</small>
              </span>
              <v-btn
                icon
                size="x-small"
                variant="text"
                :disabled="cell.nextMs === null"
                :aria-label="t('missionCoverage.cell.next')"
                :title="t('missionCoverage.cell.next')"
                @click="jump(cell.nextMs)"
              >
                <SkipForward :size="15" />
              </v-btn>
              <v-btn
                icon
                size="x-small"
                variant="text"
                :aria-label="t('missionCoverage.cell.clear')"
                @click="coverage.selectedCell = null"
              >
                <X :size="15" />
              </v-btn>
            </template>
            <span v-else class="muted text-caption grow">{{ t('missionCoverage.cell.hint') }}</span>
            <v-btn
              size="x-small"
              variant="text"
              :aria-label="t('missionCoverage.exportLabel')"
              :title="t('missionCoverage.exportLabel')"
              data-testid="coverage-csv"
              @click="exportCsv"
            >
              CSV
            </v-btn>
          </div>
        </template>
        <v-alert
          v-for="failure in coverage.failures"
          :key="failure.run.id"
          type="error"
          variant="tonal"
          density="compact"
          data-testid="coverage-failure"
        >
          {{
            t('missionCoverage.failed', {
              satellite: failure.run.name,
              error: apiErrorText(failure.error, t),
            })
          }}
        </v-alert>
        <v-alert
          v-for="warning in warnings"
          :key="warning"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ warning }}
        </v-alert>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Grid3x3, SkipForward, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText, warningTexts } from '../api/messages'
import {
  cellCentre,
  gridShape,
  METRICS,
  RESOLUTION_IDS,
  RESOLUTIONS,
  toCsv,
  type Metric,
} from '../mission/coverage'
import { useClockStore } from '../stores/clock'
import { useCoverageStore } from '../stores/coverage'
import { useMissionStore } from '../stores/mission'
import { useRunsStore } from '../stores/runs'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { saveText } from '../utils/download'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'
import AoiTargetList from './AoiTargetList.vue'
import CoverageLegend from './CoverageLegend.vue'
import PlannedRunsNote from './PlannedRunsNote.vue'
import PointingChips from './PointingChips.vue'

/**
 * The coverage analysis: one area cut into cells, and how often and how far apart each
 * cell can be imaged by the propagated satellites together. Areas are the box targets of
 * the imaging plan, so one made here is also there.
 */
const { t } = useI18n()
const { formatDuration } = useTimeText()
const coverage = useCoverageStore()
const mission = useMissionStore()
const runs = useRunsStore()
const clock = useClockStore()
const theme = useThemePreset()

/** The grid a computation would use now. */
const shape = computed(() =>
  coverage.target
    ? gridShape(coverage.target, RESOLUTIONS[coverage.settings.resolution])
    : { nx: 0, ny: 0 },
)

const satellites = computed(() =>
  (coverage.result?.satellites ?? []).map((item) => ({
    key: item.key,
    name: item.run.name,
    color: orbitColorHex(item.run.colorIndex, theme.preset.globe.orbitPalette),
  })),
)

const warnings = computed(() => {
  const all = (coverage.result?.satellites ?? []).flatMap((item) => warningTexts(item.warnings, t))
  return [...new Set(all)]
})

const duration = (seconds: number | null) =>
  seconds === null || Number.isNaN(seconds) ? '–' : formatDuration(seconds)

function show(metric: Metric, value: number): string {
  if (Number.isNaN(value)) return '–'
  return metric === 'count'
    ? t('missionCoverage.legend.times', { count: Math.round(value) })
    : formatDuration(value)
}

const legend = computed(() => {
  const range = coverage.range
  const metric = coverage.settings.metric
  return range
    ? { low: show(metric, range.min), high: show(metric, range.max) }
    : { low: '–', high: '–' }
})

const stats = computed(() => {
  const summary = coverage.summary
  if (!summary) return []
  const empty = summary.empty
    ? t('missionCoverage.emptyCells', { count: summary.empty })
    : undefined
  return [
    {
      id: 'covered',
      value: `${(summary.covered * 100).toFixed(1)}%`,
      warn: summary.empty > 0,
      title: empty,
    },
    { id: 'worstGap', value: duration(summary.worstGapS), warn: summary.empty > 0, title: empty },
    { id: 'meanGap', value: duration(summary.meanGapS), warn: false, title: undefined },
    { id: 'medianFirst', value: duration(summary.medianFirstS), warn: false, title: undefined },
  ]
})

/** The picked cell: where it is, its four values, and its next event after the clock. */
const cell = computed(() => {
  const index = coverage.selectedCell
  const grid = coverage.result?.grid
  const values = coverage.values
  const times = index === null ? null : coverage.events?.[index]
  if (index === null || !grid || !values || !times) return null
  const centre = cellCentre(grid, index)
  return {
    place: { lat: centre.lat_deg.toFixed(2), lon: centre.lon_deg.toFixed(2) },
    values: {
      count: values.count[index]!,
      maxGap: duration(values.maxGap[index]!),
      meanGap: duration(values.meanGap[index]!),
      first: duration(values.first[index]!),
    },
    nextMs: times.find((ms) => ms > clock.currentMs) ?? times[0] ?? null,
  }
})

function jump(ms: number | null) {
  if (ms !== null) revealWithinRuns(clock, runs.runs, ms)
}

function exportCsv() {
  const grid = coverage.result?.grid
  if (!grid || !coverage.values) return
  const stamp = formatUtc(clock.currentMs, false)
    .replace(/[^0-9]/g, '')
    .slice(0, 12)
  saveText(`soda-coverage-${stamp}.csv`, toCsv(grid, coverage.values), 'text/csv')
}
</script>

<style scoped>
.under {
  margin: calc(var(--space-1) - var(--stack-gap)) 0 0;
  font-variant-numeric: tabular-nums;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.dot {
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 50%;
}
.metrics :deep(.v-btn) {
  padding-inline: 0;
  font-size: 12px;
}
.cell {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 34px;
}
.cell .grow {
  flex: 1;
  min-width: 0;
}
.cell small {
  display: block;
  color: rgb(var(--v-theme-secondary));
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
</style>
