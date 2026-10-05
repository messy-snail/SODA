<template>
  <div v-if="!planned.length" class="empty-hint">
    {{ t('passes.needRun') }}
    <br />
    <v-btn
      size="small"
      variant="tonal"
      color="primary"
      class="mt-2"
      @click="ui.openSatelliteStep(basket.focus ? 'propagate' : 'pick')"
    >
      {{ t('passes.toPropagate') }}
    </v-btn>
  </div>
  <div v-else data-testid="pass-satellites">
    <p class="section-label">
      {{ t('passes.satellites', { count: planned.length, max: MAX_SATELLITES }) }}
    </p>
    <p v-if="planned.length > 1" class="muted text-caption hint">
      {{ t('passes.satellitesHint') }}
    </p>
    <div class="list">
      <div
        v-for="(run, index) in planned"
        :key="run.id"
        class="list-row"
        data-testid="pass-satellite"
      >
        <strong v-if="planned.length > 1" class="rank">{{ index + 1 }}</strong>
        <i class="swatch" :style="{ background: orbitColor(run) }" aria-hidden="true" />
        <span class="grow">
          <strong>{{ run.name }}</strong>
          <small>{{ windowText(index) }}</small>
        </span>
        <template v-if="planned.length > 1">
          <v-btn
            icon
            size="x-small"
            variant="text"
            :disabled="index === 0"
            :aria-label="t('passes.moveUp')"
            @click="passes.move(runs.runs, run.id, -1)"
          >
            <ChevronUp :size="14" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :disabled="index === planned.length - 1"
            :aria-label="t('passes.moveDown')"
            @click="passes.move(runs.runs, run.id, 1)"
          >
            <ChevronDown :size="14" />
          </v-btn>
        </template>
      </div>
    </div>
    <v-text-field
      v-if="planned.length > 1"
      v-model.number="passes.turnaroundS"
      class="mt-2"
      type="number"
      min="0"
      :max="MAX_TURNAROUND_S"
      :label="t('passes.turnaround')"
      :title="t('passes.turnaroundHint')"
    />
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePassesStore } from '../stores/passes'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useUiStore } from '../stores/ui'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { MAX_PASS_DAYS, MAX_SATELLITES, MAX_TURNAROUND_S, planWindows } from '../utils/passPlan'
import { formatUtc } from '../utils/time'

/**
 * The propagated runs a prediction covers, in priority order: when two want the same
 * station at once, the upper one gets it. Each is searched over its own window.
 */
const { t } = useI18n()
const passes = usePassesStore()
const runs = useRunsStore()
const basket = useSatelliteBasketStore()
const ui = useUiStore()
const theme = useThemePreset()

const planned = computed(() => passes.ordered(runs.runs).slice(0, MAX_SATELLITES))
const windows = computed(() => planWindows(planned.value))

function orbitColor(run: OrbitRun) {
  return orbitColorHex(run.colorIndex, theme.preset.globe.orbitPalette)
}

function windowText(index: number) {
  const window = windows.value[index]
  if (!window) return ''
  const text = t('passes.runWindow', {
    start: formatUtc(window.startMs, false),
    end: formatUtc(window.endMs, false),
  })
  if (!window.clipped) return text
  const days = Math.round((window.endMs - window.startMs) / 86_400_000)
  return `${text} · ${t('passes.firstDays', { days: Math.min(days, MAX_PASS_DAYS) })}`
}
</script>

<style scoped>
.list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.list-row .grow > small {
  display: block;
}
.hint {
  margin: -2px 0 4px;
}
.rank {
  flex: none;
  width: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
</style>
