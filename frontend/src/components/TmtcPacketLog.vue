<template>
  <div class="log" role="log" :aria-label="t('missionTmtc.log')" data-testid="tmtc-log">
    <div v-for="entry in entries" :key="entry.key" class="entry" :class="kind(entry)">
      <template v-if="entry.type === 'packet'">
        <span class="time">{{ clockText(entry.time_ms) }}</span>
        <span class="dir" :title="t(`missionTmtc.dir.${entry.dir}`)">
          {{ entry.dir === 'up' ? '↑' : '↓' }}
        </span>
        <span class="apid">{{ apidName(entry.apid) }} #{{ entry.seq }}</span>
        <span v-if="entry.replay" class="tag">{{ t('missionTmtc.replay') }}</span>
        <span class="summary">{{ summary(entry.decoded) }}</span>
        <code class="hex" :title="entry.hex">{{ entry.hex }}</code>
      </template>
      <span v-else-if="entry.type === 'queued'" class="note">
        {{ t('missionTmtc.queuedEntry', { command: summary(entry.command), count: entry.queued }) }}
      </span>
      <span v-else-if="entry.type === 'dropped'" class="note">
        {{ t('missionTmtc.droppedEntry', { count: entry.count ?? 0 }) }}
      </span>
      <span v-else-if="entry.type === 'reset'" class="note">{{ t('missionTmtc.resetEntry') }}</span>
      <span v-else class="note">{{ entry.message }}</span>
    </div>
    <div v-if="!entries.length" class="empty-hint">{{ t('missionTmtc.noPackets') }}</div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LogEntry } from '../mission/tmtcLog'
import { formatUtc } from '../utils/time'

defineProps<{ entries: readonly LogEntry[] }>()

const { t } = useI18n()

const APIDS: Record<number, string> = { 100: 'HK', 101: 'EVT', 200: 'TC' }
const apidName = (apid: number) => APIDS[apid] ?? `APID ${apid}`
const clockText = (ms: number) => formatUtc(ms).slice(11)
const kind = (entry: LogEntry) =>
  entry.type === 'packet' ? entry.dir : entry.type === 'error' ? 'error' : 'note'

/** One line for a decoded packet: key=value pairs, nested commands inlined. */
function summary(decoded: Record<string, unknown>): string {
  return Object.entries(decoded)
    .filter(([key]) => key !== 'time_ms')
    .map(([key, value]) =>
      value && typeof value === 'object'
        ? `${key}(${summary(value as Record<string, unknown>)})`
        : `${key}=${String(value)}`,
    )
    .join(' ')
}
</script>

<style scoped>
.log {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1px;
  max-height: 340px;
  overflow-y: auto;
  font-size: 11.5px;
}
.entry {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.entry.up {
  background: rgba(var(--v-theme-warning), 0.08);
}
.entry.error {
  color: rgb(var(--v-theme-error));
}
.time,
.apid {
  font-variant-numeric: tabular-nums;
}
.dir {
  font-weight: 700;
}
.up .dir {
  color: rgb(var(--v-theme-warning));
}
.down .dir {
  color: rgb(var(--v-theme-primary));
}
.tag {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  background: rgba(var(--v-theme-secondary), 0.2);
}
.summary {
  flex: 1 1 100%;
  color: rgb(var(--v-theme-secondary));
}
.hex {
  flex: 1 1 100%;
  overflow: hidden;
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
}
.note {
  color: rgb(var(--v-theme-secondary));
}
</style>
