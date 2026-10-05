<template>
  <div v-if="chips.length || link" class="contact-chips" aria-live="polite">
    <button
      v-if="link"
      type="button"
      class="contact-chip glass-chip"
      :class="{ idle: !link.open }"
      data-testid="tmtc-chip"
      :aria-label="link.label"
      :title="link.label"
      @click="ui.openTool('tmtc')"
    >
      <i class="live-dot" aria-hidden="true" />
      <strong class="number">TC/TM</strong>
      <template v-if="link.open">
        <span class="name">{{ link.station }}</span>
        <span class="state">{{ t('missionTmtc.chip.open') }}</span>
        <span class="remaining">{{ t('missionTmtc.chip.counts', link.counts) }}</span>
        <span v-if="link.remaining" class="remaining">
          {{ t('passes.remaining', { time: link.remaining }) }}
        </span>
      </template>
      <template v-else>
        <span class="remaining">{{ link.waiting }}</span>
        <span v-if="link.queued" class="queued">
          {{ t('missionTmtc.chip.queued', { count: link.queued }) }}
        </span>
      </template>
    </button>
    <button
      v-for="chip in chips"
      :key="chip.key"
      type="button"
      class="contact-chip glass-chip"
      data-testid="contact-chip"
      :aria-label="chip.label"
      :title="chip.label"
      @click="ui.openTool('passes')"
    >
      <i class="live-dot" aria-hidden="true" />
      <i class="swatch" :style="{ background: chip.color }" aria-hidden="true" />
      <strong class="number">{{ t('passes.passNo', { n: chip.number }) }}</strong>
      <span class="name">{{ chip.name }}</span>
      <span class="state">{{ t('passes.inContact') }}</span>
      <span class="remaining">{{ t('passes.remaining', { time: chip.remaining }) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import { stationLabel } from '../stations/presets'
import { useClockStore } from '../stores/clock'
import { useLayersStore } from '../stores/layers'
import { passKey, usePassesStore } from '../stores/passes'
import { useTmtcStore } from '../stores/tmtc'
import { useUiStore } from '../stores/ui'
import { usePassColors } from '../utils/usePassColors'
import { activeContacts, formatCountdown } from '../utils/passTimeline'

const { t } = useI18n()
const locale = useLocaleStore()
const clock = useClockStore()
const layers = useLayersStore()
const passes = usePassesStore()
const tmtc = useTmtcStore()
const ui = useUiStore()
const { passColor } = usePassColors()

/** The simulated TC/TM link for as long as a session runs, open or waiting for its next AOS. */
const link = computed(() => {
  const view = tmtc.view
  if (!view.active) return null
  const state = view.link
  const now = clock.currentMs
  if (state?.open) {
    const station = passes.stations.find((item) => item.id === state.station_id)
    const contact = view.contacts.find(
      (item) => item.station_id === state.station_id && item.aos_ms <= now && now < item.los_ms,
    )
    const name = station ? stationLabel(station, locale.locale) : ''
    return {
      open: true as const,
      station: name,
      counts: view.counts,
      remaining: contact ? formatCountdown(contact.los_ms - now) : '',
      label: t('missionTmtc.chip.openLabel', { station: name }),
    }
  }
  const next = state?.next_aos_ms
  const waiting = next
    ? t('missionTmtc.chip.nextAos', { time: formatCountdown(next - now) })
    : t('missionTmtc.chip.noMore')
  return {
    open: false as const,
    waiting,
    queued: state?.queued ?? 0,
    label: t('missionTmtc.chip.closedLabel', { state: waiting }),
  }
})

/** Every contact the clock sits in, whether or not its track is shown on the globe. */
const chips = computed(() => {
  if (!layers.prefs.showStations) return []
  // A pass dropped for a conflict is not served, so it is not "in contact".
  const served = passes.timeline.filter((entry) => entry.pass.status === 'assigned')
  return activeContacts(served, clock.currentMs).map(({ entry, remainingMs }) => {
    const key = passKey(entry.pass)
    const number = passes.numberOf(key)
    const station = stationLabel(entry.station, locale.locale)
    const name = passes.multi
      ? `${passes.satelliteName(entry.pass.satellite_index)} → ${station}`
      : station
    const remaining = formatCountdown(remainingMs)
    return {
      key,
      number,
      name,
      remaining,
      color: passColor(entry),
      label: t('passes.contactChipLabel', { n: number, station: name, time: remaining }),
    }
  })
})
</script>

<style scoped>
/* One row under the frame chips, right-aligned like them. */
.contact-chips {
  position: absolute;
  top: calc(var(--frame-top, 0px) + 50px);
  /* Beside the swath inspector (or its edge tab) while a run is selected; see styles.css. */
  right: var(--right-edge, 14px);
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: calc(100% - var(--right-edge, 14px) - 14px);
  pointer-events: none;
}
.contact-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 10px 3px 8px;
  border: 1px solid rgba(var(--v-theme-success), 0.7);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), var(--lg-alpha, 0.8));
  backdrop-filter: var(--lg-fallback);
  color: rgb(var(--v-theme-on-surface));
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  pointer-events: auto;
}
.contact-chip:hover,
.contact-chip:focus-visible {
  background: rgba(var(--v-theme-success), 0.14);
}
/* The simulated link between contacts: still there, but nothing is live. */
.contact-chip.idle {
  border-color: rgba(var(--v-theme-secondary), 0.6);
}
.contact-chip.idle:hover,
.contact-chip.idle:focus-visible {
  background: rgba(var(--v-theme-secondary), 0.14);
}
.idle .live-dot {
  background: rgb(var(--v-theme-secondary));
  animation: none;
}
.queued {
  flex: none;
  color: rgb(var(--v-theme-warning));
  font-weight: 600;
}
.live-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  animation: contact-pulse 1.6s ease-out infinite;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.number {
  flex: none;
}
.name {
  overflow: hidden;
  max-width: 180px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state {
  flex: none;
  color: rgb(var(--v-theme-success));
  font-weight: 700;
}
.remaining {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
@keyframes contact-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0.6);
  }
  100% {
    box-shadow: 0 0 0 6px rgba(var(--v-theme-success), 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-dot {
    animation: none;
  }
}
</style>
