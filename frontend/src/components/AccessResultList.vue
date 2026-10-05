<template>
  <div class="form-stack">
    <div class="summary" data-testid="access-summary">
      <template v-if="mission.multi">
        <v-chip
          size="small"
          :variant="filter === null ? 'tonal' : 'outlined'"
          :color="filter === null ? 'primary' : undefined"
          :aria-pressed="filter === null"
          data-testid="access-filter-all"
          @click="filter = null"
        >
          {{ t('mission.access.total', { count: mission.shots.length }) }}
        </v-chip>
        <v-chip
          v-for="satellite in satellites"
          :key="satellite.key"
          size="small"
          :variant="filter === satellite.key ? 'tonal' : 'outlined'"
          :aria-pressed="filter === satellite.key"
          :title="t('mission.access.filter', { satellite: satellite.name })"
          data-testid="access-filter"
          @click="filter = filter === satellite.key ? null : satellite.key"
        >
          <i class="dot" :style="{ background: satellite.color }" aria-hidden="true" />
          {{ t('mission.access.summary', { satellite: satellite.name, count: satellite.count }) }}
        </v-chip>
      </template>
      <span v-else-if="satellites[0]" class="muted text-caption">
        {{
          t('mission.access.summary', {
            satellite: satellites[0].name,
            count: satellites[0].count,
          })
        }}
      </span>
    </div>
    <div class="window-list">
      <template v-for="(shot, index) in rows" :key="shot.key">
        <p v-if="dayOf(index) !== dayOf(index - 1)" class="day-head">{{ dayOf(index) }} UTC</p>
        <AccessWindowRow
          :window="shot.window"
          :target-name="shot.targetName"
          :box="shot.box"
          :pitch="mission.resultPointing?.mode === 'roll_pitch'"
          :active="isActive(shot)"
          :satellite-name="mission.multi ? shot.run.name : undefined"
          :color="mission.multi ? colorOf(shot.run.colorIndex) : undefined"
          @pick="emit('pick', shot.bestMs)"
        />
      </template>
      <div v-if="!rows.length" class="empty-hint">{{ t('mission.access.none') }}</div>
    </div>
    <v-alert
      v-for="failure in mission.failures"
      :key="failure.run.id"
      type="error"
      variant="tonal"
      density="compact"
      data-testid="access-failure"
    >
      {{
        t('mission.access.failed', {
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText, warningTexts } from '../api/messages'
import type { Shot } from '../mission/shots'
import { useClockStore } from '../stores/clock'
import { useMissionStore } from '../stores/mission'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { formatUtc } from '../utils/time'
import AccessWindowRow from './AccessWindowRow.vue'

/**
 * The imaging opportunities of the last search: every satellite's windows on one list in
 * time order. With several satellites each row carries its satellite's orbit colour and
 * the chips above narrow the list to one of them.
 */
const emit = defineEmits<{ pick: [ms: number] }>()

const { t } = useI18n()
const mission = useMissionStore()
const clock = useClockStore()
const theme = useThemePreset()
/** `satKey` of the one satellite shown, or null for all of them. */
const filter = ref<string | null>(null)

const colorOf = (index: number) => orbitColorHex(index, theme.preset.globe.orbitPalette)

const satellites = computed(() =>
  mission.results.map(({ key, run }) => ({
    key,
    name: run.name,
    color: colorOf(run.colorIndex),
    count: mission.shots.filter((shot) => shot.satKey === key).length,
  })),
)
watch(
  () => mission.results,
  () => (filter.value = null),
)

const rows = computed(() =>
  filter.value === null
    ? mission.shots
    : mission.shots.filter((shot) => shot.satKey === filter.value),
)

/** Each satellite's warnings, named when there is more than one to tell apart. */
const warnings = computed(() => [
  ...new Set(
    mission.results.flatMap(({ run, response }) =>
      warningTexts(response.warnings, t).map((text) =>
        mission.multi ? `${run.name} · ${text}` : text,
      ),
    ),
  ),
])

function dayOf(index: number) {
  const shot = rows.value[index]
  return shot ? formatUtc(shot.bestMs).slice(0, 10) : ''
}

function isActive({ window }: Shot) {
  return Date.parse(window.start) <= clock.currentMs && clock.currentMs <= Date.parse(window.end)
}
</script>

<style scoped>
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.dot {
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}
.window-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.day-head {
  margin: 6px 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
}
</style>
