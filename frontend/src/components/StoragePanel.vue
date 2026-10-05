<template>
  <div class="form-stack" data-testid="mission-storage">
    <template v-if="run">
      <RunSelect
        :runs="target.eligible.value"
        :model-value="run.id"
        :label="t('mission.target')"
        test-id="target-run-select"
        @update:model-value="target.select"
      >
        <template v-if="result" #subtitle>
          {{
            t('missionStorage.sources', { shots: storage.shots.length, contacts: usable.length })
          }}
        </template>
      </RunSelect>
      <Sgp4OnlyNote :runs="target.noted.value" />
    </template>
    <div v-if="!run || !result" class="empty-hint">
      {{ t('missionStorage.needAccess') }}
      <br />
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        class="mt-2"
        @click="ui.openTool('imaging')"
      >
        {{ t('missionStorage.toAccess') }}
      </v-btn>
    </div>
    <template v-else>
      <v-alert
        v-if="storage.planIndex < 0"
        type="info"
        variant="tonal"
        density="compact"
        data-testid="storage-no-plan"
      >
        {{ t('missionStorage.noPlan') }}
        <template #append>
          <v-btn size="x-small" variant="text" @click="ui.openTool('passes')">
            {{ t('missionStorage.toContacts') }}
          </v-btn>
        </template>
      </v-alert>
      <p
        v-if="storage.imaging && storage.imaging.run.id !== run.id"
        class="field-note"
        data-testid="storage-run-stale"
      >
        {{ t('missionStorage.runStale') }}
      </p>
      <p
        v-else-if="mission.resultPointing?.key !== mission.pointingKey"
        class="field-note"
        data-testid="storage-stale"
      >
        {{ t('missionStorage.shotStale') }}
      </p>

      <div class="stat-grid" data-testid="storage-stats">
        <div
          v-for="stat in stats"
          :key="stat.id"
          class="stat"
          :class="stat.level ? `stat--${stat.level}` : undefined"
          :data-level="stat.level ?? undefined"
          :data-testid="`storage-${stat.id}`"
        >
          <span>{{ t(`missionStorage.${stat.id}`) }}</span
          ><strong>{{ stat.value }}</strong
          ><small>{{ stat.unit }}</small>
        </div>
      </div>

      <LevelChart
        data-testid="storage-chart"
        :label="t('missionStorage.chart')"
        :points="result.points"
        :max="storage.model.capacityBits * 1.08"
        :line="storage.model.capacityBits"
        :start-ms="run.startMs"
        :end-ms="run.stopMs"
        :alerts="result.lostSpans"
        :shades="usable"
        :now-ms="clock.currentMs"
        @seek="seek"
      />

      <CollapsibleSection
        id="storage.images"
        :title="
          t('missionStorage.shots', { count: storage.shots.length, total: storage.windows.length })
        "
        :summary="
          t('missionStorage.shotsSummary', {
            delivered: result.deliveredCount,
            pending: result.pendingCount,
            lost: result.lostCount,
          })
        "
      >
        <StorageImageList @seek="seek" />
      </CollapsibleSection>
      <CollapsibleSection
        id="storage.passes"
        :title="t('missionStorage.passes', { count: storage.contacts.length })"
        :summary="t('missionStorage.passesSummary', { used })"
      >
        <StoragePassList @seek="seek" />
      </CollapsibleSection>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StatLevel } from '../mission/power'
import { formatGbit, storageStatLevels } from '../mission/storage'
import { useTargetRun } from '../orbit/useTargetRun'
import { useClockStore } from '../stores/clock'
import { useMissionStore } from '../stores/mission'
import { useStorageStore } from '../stores/storage'
import { useUiStore } from '../stores/ui'
import { useTimeText } from '../utils/useTimeText'
import CollapsibleSection from './CollapsibleSection.vue'
import LevelChart from './LevelChart.vue'
import RunSelect from './RunSelect.vue'
import Sgp4OnlyNote from './Sgp4OnlyNote.vue'
import StorageImageList from './StorageImageList.vue'
import StoragePassList from './StoragePassList.vue'

/**
 * The recorder of the target satellite over its run: what was imaged, sent and
 * lost, the fill level, and behind two folds every image and every downlink contact.
 */
const { t } = useI18n()
const { formatDuration } = useTimeText()
const mission = useMissionStore()
const storage = useStorageStore()
const clock = useClockStore()
const ui = useUiStore()

/** The picker's runs and notes; the store resolves the same target by the same rule. */
const target = useTargetRun({ elementsOnly: true })
const run = computed(() => storage.run)
const result = computed(() => storage.result)
/** Contacts with a span that can carry data, which the chart shades. */
const usable = computed(() => storage.contacts.filter((contact) => contact.endMs > contact.startMs))
const used = computed(() => result.value?.passes.filter((pass) => pass.sentBits > 0).length ?? 0)

function seek(ms: number) {
  const span = run.value
  if (span) clock.reveal(Math.min(Math.max(ms, span.startMs), span.stopMs))
}

const stats = computed(() => {
  const data = result.value
  if (!data) return []
  const capacity = storage.model.capacityBits
  const levels = storageStatLevels(data, capacity)
  const stat = (id: string, value: string, unit: string, level: StatLevel = null) => ({
    id,
    value,
    unit,
    level,
  })
  return [
    stat('imaged', formatGbit(data.imagedBits), 'Gbit'),
    stat('downlinked', formatGbit(data.downlinkedBits), 'Gbit'),
    stat('peak', ((data.peakBits / capacity) * 100).toFixed(0), '%', levels.peak),
    stat('remaining', formatGbit(data.finalBits), 'Gbit'),
    stat(
      'lost',
      String(data.lostCount),
      data.lostCount ? t('missionStorage.lostUnit', { gbit: formatGbit(data.lostBits) }) : '',
      levels.lost,
    ),
    stat(
      'latency',
      data.meanLatencyMs === null ? '–' : formatDuration(data.meanLatencyMs / 1000),
      data.maxLatencyMs === null
        ? ''
        : t('missionStorage.latencyMax', { time: formatDuration(data.maxLatencyMs / 1000) }),
    ),
  ]
})
</script>
