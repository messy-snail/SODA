<template>
  <div class="rows">
    <div
      v-for="row in rows"
      :key="row.key"
      class="list-row image"
      :data-status="row.status"
      data-testid="storage-image"
    >
      <input
        type="checkbox"
        :checked="row.status !== 'excluded'"
        :aria-label="t('missionStorage.take', { name: row.name })"
        @change="mission.toggleShot(row.key)"
      />
      <button
        type="button"
        class="grow jump"
        :aria-label="t('missionStorage.imageRow', { name: row.name, time: row.time })"
        @click="emit('seek', row.bestMs)"
      >
        <strong>{{ row.name }}</strong>
        <small
          >{{ row.time.slice(5) }} UTC<template v-if="row.detail"> · {{ row.detail }}</template>
        </small>
      </button>
      <v-chip v-if="row.urgent" size="x-small" color="warning">
        {{ t('missionStorage.urgent') }}
      </v-chip>
      <v-chip size="x-small" :color="STATUS_COLORS[row.status]">
        {{ t(`missionStorage.status.${row.status}`) }}
      </v-chip>
    </div>
    <div v-if="!rows.length" class="empty-hint">{{ t('missionStorage.noShots') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import type { FileStatus } from '../mission/recorder'
import { stationLabel } from '../stations/presets'
import { useMissionStore } from '../stores/mission'
import { useStorageStore } from '../stores/storage'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'

type RowStatus = FileStatus | 'excluded'

const STATUS_COLORS: Record<RowStatus, string | undefined> = {
  delivered: 'success',
  pending: undefined,
  lost: 'error',
  excluded: undefined,
}

/**
 * Every imaging window of the result: whether it is taken, and what became of its image.
 * The tick is the same one the power tool reads, so unticking a window spares both.
 */
const emit = defineEmits<{ seek: [ms: number] }>()
const { t } = useI18n()
const { formatDuration } = useTimeText()
const locale = useLocaleStore()
const mission = useMissionStore()
const storage = useStorageStore()

const rows = computed(() => {
  const files = new Map(storage.result?.files.map((file) => [file.key, file]))
  const stations = new Map(
    storage.planStations.map((station) => [station.id, stationLabel(station, locale.locale)]),
  )
  return storage.windows.map((window) => {
    const file = files.get(window.key)
    let detail = ''
    if (file?.status === 'delivered' && file.latencyMs !== null) {
      detail = t('missionStorage.deliveredAt', {
        station: stations.get(file.stationId ?? -1) ?? '',
        latency: formatDuration(file.latencyMs / 1000),
      })
    } else if (file?.status === 'pending' && file.sentBits > 0) {
      detail = t('missionStorage.partly', {
        percent: ((file.sentBits / file.sizeBits) * 100).toFixed(0),
      })
    }
    return {
      key: window.key,
      name: window.name,
      bestMs: window.bestMs,
      time: formatUtc(window.bestMs),
      status: (file?.status ?? 'excluded') as RowStatus,
      urgent: file?.urgent === true && storage.model.priority,
      detail,
    }
  })
})
</script>

<style scoped>
.rows {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.image {
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  cursor: default;
}
.image[data-status='excluded'] .jump {
  opacity: 0.55;
}
.jump {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
</style>
