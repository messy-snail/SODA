<template>
  <v-card
    class="dashboard-card glass glass--clear pass-dock"
    data-testid="pass-timeline-dock"
    role="region"
    :aria-label="t('passes.timelineTitle')"
  >
    <div class="head">
      <ChartGantt :size="15" class="text-primary" aria-hidden="true" />
      <strong>{{ t('passes.timelineTitle') }}</strong>
      <span class="muted">{{ t('passes.count', { count: passes.timeline.length }) }} · UTC</span>
      <small class="muted hint">{{ t('passes.timelineHint') }}</small>
      <v-spacer />
      <v-btn
        icon
        size="x-small"
        variant="text"
        data-testid="pass-timeline-pin"
        :aria-pressed="ui.timelinePinned"
        :aria-label="t(ui.timelinePinned ? 'app.dock.unpin' : 'app.dock.pin')"
        :title="t(ui.timelinePinned ? 'app.dock.unpin' : 'app.dock.pin')"
        @click="ui.timelinePinned = !ui.timelinePinned"
      >
        <component :is="ui.timelinePinned ? PinOff : Pin" :size="15" />
      </v-btn>
      <v-btn
        icon
        size="x-small"
        variant="text"
        :aria-label="t('passes.closeTimeline')"
        :title="t('passes.closeTimeline')"
        @click="passes.timelineOpen = false"
      >
        <X :size="15" />
      </v-btn>
    </div>
    <div class="grid">
      <span aria-hidden="true" />
      <div class="axis" aria-hidden="true">
        <span
          v-for="tick in ticks"
          :key="tick.ms"
          :class="{ day: tick.day }"
          :style="{ left: `${tick.at * 100}%` }"
          >{{ tick.label }}</span
        >
      </div>
      <span aria-hidden="true" />
      <template v-for="row in rows" :key="row.id">
        <span class="name" :title="row.name">
          <i class="swatch" :style="{ background: row.color }" aria-hidden="true" />
          {{ row.name }}
        </span>
        <div class="track" :style="{ backgroundImage: trustGradient }" @click="seekAt">
          <i
            v-for="tick in ticks"
            :key="tick.ms"
            class="gridline"
            :class="{ day: tick.day }"
            :style="{ left: `${tick.at * 100}%` }"
            aria-hidden="true"
          />
          <button
            v-for="bar in row.bars"
            :key="bar.key"
            type="button"
            class="bar"
            :class="{
              clipped: bar.clipped,
              limited: bar.maskLimited,
              hidden: !bar.shown,
              active: bar.active,
              rejected: bar.rejected,
            }"
            :style="{
              left: `${bar.start * 100}%`,
              width: `${bar.width * 100}%`,
              '--bar': bar.color,
            }"
            :title="bar.title"
            :aria-label="bar.title"
            @click.stop="revealWithinRuns(clock, runs.runs, jumpTarget(bar, ui.contactJump))"
          />
          <i
            v-if="cursor !== null"
            class="cursor"
            :style="{ left: `${cursor * 100}%` }"
            aria-hidden="true"
          />
        </div>
        <span class="count">{{ row.bars.length }}</span>
      </template>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ChartGantt, Pin, PinOff, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import { stationLabel } from '../stations/presets'
import { bandsGradient, farthestDays, trustBands } from '../orbit/epochTrust'
import { useClockStore } from '../stores/clock'
import { passKey, usePassesStore } from '../stores/passes'
import { useUiStore } from '../stores/ui'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import { barLayout, jumpTarget, timelineTicks } from '../utils/passTimeline'
import { formatUtc } from '../utils/time'
import { usePassColors } from '../utils/usePassColors'
import { revealWithinRuns } from '../utils/revealWithinRuns'
import { useTimeText } from '../utils/useTimeText'
import { useRunsStore } from '../stores/runs'

const DAY_MS = 86_400_000

const { t } = useI18n()
const { formatDuration } = useTimeText()
const locale = useLocaleStore()
const passes = usePassesStore()
const clock = useClockStore()
const ui = useUiStore()
const theme = useThemePreset()
const runs = useRunsStore()
const { passColor } = usePassColors()

const span = computed(() => passes.windowMs)

/** Midnight ticks carry the date so a multi-day window still reads at a glance. */
const ticks = computed(() =>
  timelineTicks(span.value.start, span.value.end, 12).map((tick) => {
    const text = formatUtc(tick.ms, false)
    const day = tick.ms % DAY_MS === 0
    return { ...tick, day, label: day ? text.slice(5, 10) : text.slice(11) }
  }),
)

/**
 * Shades where the element sets are getting old (orbit/epochTrust.ts). A row mixes the passes
 * of every satellite, so the shading follows the one furthest from its epoch.
 */
const trustGradient = computed(() => {
  const { start, end } = span.value
  const epochs = (passes.result?.satellites ?? [])
    .map((satellite) => Date.parse(satellite.element_set.epoch))
    .filter((ms) => !Number.isNaN(ms))
  if (!epochs.length) return 'none'
  const epochMs = epochs.reduce((worst, ms) =>
    farthestDays(ms, start, end) > farthestDays(worst, start, end) ? ms : worst,
  )
  return bandsGradient(trustBands(epochMs, start, end), start, end, theme.preset.globe.trust)
})

const cursor = computed(() => {
  const { start, end } = span.value
  const now = clock.currentMs
  return now >= start && now <= end ? (now - start) / (end - start) : null
})

/** One row per station; with several satellites a row holds all of their passes there. */
const rows = computed(() =>
  passes.results.map((item) => ({
    id: item.station.id,
    name: stationLabel(item.station, locale.locale),
    color: stationColorHex(passes.colorIndexOf(item.station.id), theme.preset.globe.stationPalette),
    bars: passes.timeline
      .filter((entry) => entry.station.id === item.station.id)
      // Assigned last, so they are drawn over the passes they beat.
      .sort((a, b) => Number(a.pass.status === 'assigned') - Number(b.pass.status === 'assigned'))
      .flatMap((entry) => {
        const { pass } = entry
        const aosMs = Date.parse(pass.aos)
        const losMs = Date.parse(pass.los)
        const bar = barLayout(aosMs, losMs, span.value.start, span.value.end)
        if (!bar) return []
        const key = passKey(pass)
        const hhmmss = (iso: string) => formatUtc(Date.parse(iso)).slice(11)
        const satellite = passes.multi ? `${passes.satelliteName(pass.satellite_index)} → ` : ''
        return [
          {
            key,
            ...bar,
            color: passColor(entry),
            rejected: pass.status === 'rejected',
            maskLimited: pass.mask_limited,
            shown: passes.isPassVisible(key),
            active: aosMs <= clock.currentMs && clock.currentMs <= losMs,
            aos: pass.aos,
            tca: pass.tca,
            title: [
              `${t('passes.passNo', { n: passes.numberOf(key) })} ${satellite}${stationLabel(item.station, locale.locale)}${pass.status === 'rejected' ? ` · ${t('passes.rejected')}` : ''}`,
              `AOS ${formatUtc(aosMs)} UTC`,
              `TCA ${hhmmss(pass.tca)} · ${t('passes.maxElevation', {
                elevation: pass.max_elevation_deg.toFixed(0),
              })}`,
              `LOS ${hhmmss(pass.los)} · ${formatDuration(pass.duration_s)}`,
            ].join('\n'),
          },
        ]
      }),
  })),
)

function seekAt(event: MouseEvent) {
  const track = event.currentTarget as HTMLElement
  const box = track.getBoundingClientRect()
  const at = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
  const { start, end } = span.value
  clock.reveal(start + at * (end - start))
}
</script>

<style scoped>
.pass-dock {
  padding: 8px 14px 10px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12.5px;
  white-space: nowrap;
}
.head .muted {
  font-size: 11.5px;
}
.hint {
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 26px;
  row-gap: 4px;
  align-items: center;
}
.axis {
  position: relative;
  height: 15px;
  font-size: 10.5px;
  color: rgb(var(--v-theme-secondary));
}
.axis span {
  position: absolute;
  transform: translateX(-50%);
  font-variant-numeric: tabular-nums;
}
.axis span.day {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 700;
}
.name {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  padding-right: 10px;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.track {
  position: relative;
  height: 22px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  cursor: crosshair;
}
.gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.gridline.day {
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.bar {
  background: var(--bar);
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 3px;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}
.bar.rejected {
  background: repeating-linear-gradient(135deg, var(--bar) 0 2px, transparent 2px 5px);
  outline: 1px solid rgb(var(--v-theme-error));
  opacity: 0.75;
}
.bar:hover {
  top: 0;
  bottom: 0;
}
.bar.hidden {
  opacity: 0.3;
}
.bar.active {
  top: 0;
  bottom: 0;
  box-shadow: 0 0 0 2px rgb(var(--v-theme-on-surface));
}
.bar.clipped {
  border-radius: 0;
}
/* A mask-trimmed contact is hatched so a split window reads as two shortened passes. */
.bar.limited {
  background-image: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.35) 0 2px,
    transparent 2px 4px
  );
}
.cursor {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: rgb(var(--v-theme-primary));
  pointer-events: none;
}
.count {
  padding-left: 6px;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  text-align: right;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 760px) {
  .grid {
    grid-template-columns: 84px minmax(0, 1fr) 22px;
  }
  .hint {
    display: none;
  }
}
</style>
