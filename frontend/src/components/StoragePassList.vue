<template>
  <div class="rows">
    <button
      v-for="row in rows"
      :key="row.passId"
      type="button"
      class="list-row pass"
      :class="{ idle: !row.usableMs }"
      :aria-label="t('missionStorage.passRow', { station: row.name, time: row.time })"
      data-testid="storage-pass"
      @click="emit('seek', row.jumpMs)"
    >
      <span class="grow">
        <strong>{{ row.name }}</strong>
        <small>{{ row.time.slice(5) }} UTC · {{ row.usable }}</small>
      </span>
      <v-chip size="x-small">{{ t(`missionStorage.station.${row.band}`) }}</v-chip>
      <span class="volume">
        <strong>{{ formatGbit(row.sentBits) }}</strong>
        <small>{{
          t('missionStorage.passCapacity', { gbit: formatGbit(row.capacityBits) })
        }}</small>
      </span>
    </button>
    <div v-if="!rows.length" class="empty-hint">{{ t('missionStorage.noPasses') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import { formatGbit } from '../mission/storage'
import { stationLabel } from '../stations/presets'
import { useStorageStore } from '../stores/storage'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'

/**
 * Every assigned contact at a downlink station: how long it can carry data, and how much of
 * what it could carry was actually sent.
 */
const emit = defineEmits<{ seek: [ms: number] }>()
const { t } = useI18n()
const { formatDuration } = useTimeText()
const locale = useLocaleStore()
const storage = useStorageStore()

const rows = computed(() => {
  const passes = new Map(storage.result?.passes.map((pass) => [pass.passId, pass]))
  return storage.contacts.map((contact) => {
    const pass = passes.get(contact.passId)
    const usableMs = pass?.usableMs ?? 0
    return {
      passId: contact.passId,
      name: stationLabel(contact.station, locale.locale),
      band: contact.band,
      time: formatUtc(contact.aosMs),
      // Where the data starts flowing, or the rise of a contact that carries none.
      jumpMs: usableMs ? contact.startMs : contact.aosMs,
      usableMs,
      usable: usableMs
        ? t('missionStorage.passUsable', { time: formatDuration(usableMs / 1000) })
        : t('missionStorage.noUsable'),
      sentBits: pass?.sentBits ?? 0,
      capacityBits: pass?.capacityBits ?? 0,
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
.pass {
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
}
.pass.idle {
  opacity: 0.55;
}
.volume {
  flex: none;
  text-align: right;
}
.volume strong {
  font-variant-numeric: tabular-nums;
}
</style>
