<template>
  <DashboardCard :title="t('propagate.runs.title')" eyebrow="RUNS" :icon="ListOrdered">
    <div class="form-stack">
      <div class="frame-controls">
        <v-btn-toggle
          :model-value="layers.prefs.frame"
          @update:model-value="(frame: OrbitFrame) => layers.requestFrame(frame)"
          density="compact"
          class="frame-toggle"
          :disabled="ui.sceneMode === '2d'"
          :aria-label="t('propagate.runs.frame')"
        >
          <v-btn value="fixed" size="small" :aria-pressed="layers.prefs.frame === 'fixed'">{{
            t('propagate.runs.fixed')
          }}</v-btn>
          <v-btn value="inertial" size="small" :aria-pressed="layers.prefs.frame === 'inertial'">{{
            t('propagate.runs.inertial')
          }}</v-btn>
        </v-btn-toggle>
        <v-tooltip :text="frameHint" location="bottom" max-width="280">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              size="x-small"
              variant="text"
              :aria-label="t('propagate.runs.frameInfo')"
            >
              <Info :size="15" />
            </v-btn>
          </template>
        </v-tooltip>
      </div>
      <p v-if="layers.frameState.loading" role="status" class="muted text-caption">
        {{ t('propagate.runs.frameLoading') }}
      </p>
      <p v-if="layers.frameState.failed" role="alert" class="text-warning text-caption">
        {{ t('propagate.runs.frameFailed') }}
      </p>
      <FrameCompare v-if="layers.effectiveFrame === 'inertial'" />
      <div v-if="!runs.runs.length" class="empty-hint">{{ t('propagate.runs.empty') }}</div>
      <div v-else class="run-list">
        <div
          v-for="run in runs.runs"
          :key="run.id"
          class="list-row"
          :class="{ selected: run.id === runs.selectedRunId }"
          :title="t('propagate.runs.samples', { count: run.data.count.toLocaleString() })"
          role="button"
          tabindex="0"
          @click="runs.select(run.id)"
          @keydown.enter="runs.select(run.id)"
          @mouseenter="runs.hoveredRunId = run.id"
          @mouseleave="runs.hoveredRunId = null"
        >
          <span class="color-dot" :style="{ background: colorOf(run.colorIndex) }" />
          <span class="grow">
            <strong>{{ run.name }}</strong>
            <small>
              <!-- Leads the line so a long name or date cannot push it out of sight. -->
              <v-chip
                v-if="run.propagator !== 'sgp4'"
                size="x-small"
                class="mr-1"
                :color="run.propagator === 'hpop' ? 'warning' : undefined"
                :title="run.propagator === 'hpop' ? t('propagate.hpop.experimental') : undefined"
                :data-testid="`run-propagator-${run.id}`"
              >
                <FlaskConical
                  v-if="run.propagator === 'hpop'"
                  :size="11"
                  class="mr-1"
                  :aria-label="t('propagate.hpop.experimentalTag')"
                  data-testid="run-experimental"
                />
                {{ propagatorLabel(run.propagator) }}
              </v-chip>
              {{ formatUtc(run.startMs, false) }} ·
              {{ formatDuration((run.stopMs - run.startMs) / 1000) }} ·
              {{ t('propagate.runs.every', { step: stepLabel(run.data.step_s) }) }}
            </small>
            <small class="d-block">{{ epochText(run.data.element_set.epoch) }}</small>
          </span>
          <v-tooltip
            v-if="run.data.warnings.length"
            :text="warningTexts(run.data.warnings, t).join('\n')"
            location="top"
          >
            <template #activator="{ props }">
              <TriangleAlert v-bind="props" :size="15" class="text-warning" />
            </template>
          </v-tooltip>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="t('propagate.runs.series.open')"
            :title="t('propagate.runs.series.open')"
            data-testid="run-series"
            @click.stop="seriesRunId = run.id"
          >
            <ChartSpline :size="15" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :color="runs.trackedRunId === run.id ? 'primary' : undefined"
            :aria-label="
              runs.trackedRunId === run.id ? t('propagate.runs.untrack') : t('propagate.runs.track')
            "
            :aria-pressed="runs.trackedRunId === run.id"
            @click.stop="runs.track(runs.trackedRunId === run.id ? null : run.id)"
          >
            <component :is="runs.trackedRunId === run.id ? LocateOff : LocateFixed" :size="15" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="run.visible ? t('propagate.runs.hide') : t('propagate.runs.show')"
            @click.stop="runs.toggleVisible(run.id)"
          >
            <component :is="run.visible ? Eye : EyeOff" :size="15" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :aria-label="t('common.remove')"
            @click.stop="runs.remove(run.id)"
          >
            <Trash2 :size="15" />
          </v-btn>
        </div>
      </div>
    </div>
    <RunSeriesDialog :run="seriesRun" @close="seriesRunId = null" />
  </DashboardCard>
</template>

<script setup lang="ts">
import {
  ChartSpline,
  Eye,
  EyeOff,
  FlaskConical,
  Info,
  ListOrdered,
  LocateFixed,
  LocateOff,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { warningTexts } from '../api/messages'
import { useLayersStore, type OrbitFrame } from '../stores/layers'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { propagatorLabel } from '../orbit/propagatorOptions'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'
import DashboardCard from './DashboardCard.vue'
import FrameCompare from './FrameCompare.vue'
import RunSeriesDialog from './RunSeriesDialog.vue'

const { t } = useI18n()
const { formatAgo, formatDuration } = useTimeText()

/** Which element set a run came from, and how old it is now. */
function epochText(epoch: string): string {
  const ms = Date.parse(epoch)
  return t('propagate.runs.epoch', { epoch: formatUtc(ms, false), ago: formatAgo(ms) })
}
const runs = useRunsStore()
const layers = useLayersStore()
const ui = useUiStore()
const theme = useThemePreset()

/** The run whose series dialog is open; by id, so a removed run closes it. */
const seriesRunId = ref<string | null>(null)
const seriesRun = computed(() => runs.runs.find((run) => run.id === seriesRunId.value) ?? null)

/** Step labels the propagation form offers, so a run reads the way it was set up. */
const STEP_KEYS: Record<number, string> = { 10: 's10', 30: 's30', 60: 'm1', 120: 'm2' }

const frameHint = computed(() =>
  ui.sceneMode === '2d'
    ? t('propagate.runs.frameLocked2d')
    : t(`propagate.runs.${layers.prefs.frame}Hint`),
)

function stepLabel(stepS: number) {
  const key = STEP_KEYS[stepS]
  return key ? t(`propagate.steps.${key}`) : formatDuration(stepS)
}

function colorOf(index: number) {
  return orbitColorHex(index, theme.preset.globe.orbitPalette)
}
</script>

<style scoped>
.run-list {
  display: grid;
  /* Bounded, so the nowrap subtitle ellipsizes instead of widening the rows. */
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.frame-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.run-list small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frame-toggle {
  height: 28px !important;
}
.frame-toggle .v-btn {
  font-size: 11px;
}
</style>
