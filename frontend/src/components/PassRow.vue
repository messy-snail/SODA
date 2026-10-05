<template>
  <div
    class="list-row pass-row"
    :class="{ selected: active, muted: !shown, rejected: entry.pass.status === 'rejected' }"
    role="button"
    tabindex="0"
    :aria-label="rowLabel"
    @click="emit('pick', entry.pass)"
    @keydown.enter.self="emit('pick', entry.pass)"
  >
    <v-btn
      icon
      size="x-small"
      variant="text"
      :aria-label="t(shown ? 'passes.hidePass' : 'passes.showPass')"
      :title="t(shown ? 'passes.hidePass' : 'passes.showPass')"
      :aria-pressed="shown"
      data-testid="pass-visibility"
      @click.stop="passes.togglePass(key)"
    >
      <component :is="shown ? Eye : EyeOff" :size="15" />
    </v-btn>
    <i class="swatch" :style="{ background: color }" aria-hidden="true" />
    <span class="grow">
      <span class="head">
        <strong class="number">{{ t('passes.passNo', { n: number }) }}</strong>
        <i v-if="active" class="live-dot" :title="t('passes.inContact')" aria-hidden="true" />
        <span class="station">{{ stationName }}</span>
        <span v-if="entry.pass.status === 'rejected'" class="dropped">
          {{ t('passes.rejected') }}
        </span>
      </span>
      <span v-if="satelliteName" class="satellite">{{ satelliteName }}</span>
      <span class="times">
        <span
          ><small>{{ t('passes.aos') }}</small> {{ span.aos }}</span
        >
        <span
          ><small>{{ t('passes.los') }}</small> {{ span.los }}</span
        >
        <strong class="duration">{{ formatDuration(entry.pass.duration_s) }}</strong>
      </span>
      <small>
        {{
          t('passes.azimuthRange', {
            from: entry.pass.aos_azimuth_deg.toFixed(0),
            to: entry.pass.los_azimuth_deg.toFixed(0),
          })
        }}{{ flags }}
      </small>
    </span>
    <v-btn
      icon
      size="x-small"
      variant="text"
      :aria-label="t('passes.detail.open')"
      :title="t('passes.detail.open')"
      data-testid="pass-detail"
      @click.stop="emit('detail', entry)"
    >
      <ChartSpline :size="15" />
    </v-btn>
    <v-tooltip :text="visibilityText" location="top">
      <template #activator="{ props: tip }">
        <component
          :is="entry.pass.visible ? Telescope : entry.pass.satellite_sunlit ? Sun : Moon"
          v-bind="tip"
          :size="15"
          :class="entry.pass.visible ? 'text-success' : 'muted'"
        />
      </template>
    </v-tooltip>
    <span class="elevation" :title="elevationTip">
      <small>{{ t('passes.maxElevationLabel') }}</small>
      {{ entry.pass.max_elevation_deg.toFixed(0) }}°
    </span>
  </div>
</template>

<script setup lang="ts">
import { ChartSpline, Eye, EyeOff, Moon, Sun, Telescope } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Pass } from '../api/types'
import { passKey, usePassesStore, type TimelineEntry } from '../stores/passes'
import { useUiStore } from '../stores/ui'
import { jumpTarget, passSpan } from '../utils/passTimeline'
import { formatUtc } from '../utils/time'
import { useTimeText } from '../utils/useTimeText'

const props = defineProps<{
  entry: TimelineEntry
  stationName: string
  /** Shown when the prediction covers several satellites. */
  satelliteName?: string
  color: string
  /** Chronological number of the contact across every station. */
  number: number
  /** The clock sits inside this contact. */
  active: boolean
}>()
const emit = defineEmits<{ pick: [pass: Pass]; detail: [entry: TimelineEntry] }>()

const { t } = useI18n()
const { formatDuration } = useTimeText()
const passes = usePassesStore()
const ui = useUiStore()

const key = computed(() => passKey(props.entry.pass))
const rowLabel = computed(() =>
  t('passes.rowLabel', {
    n: props.number,
    station: props.stationName,
    time: formatUtc(jumpTarget(props.entry.pass, ui.contactJump)),
  }),
)
const shown = computed(() => passes.isPassVisible(key.value))
const span = computed(() =>
  passSpan(Date.parse(props.entry.pass.aos), Date.parse(props.entry.pass.los)),
)
const elevationTip = computed(() =>
  t('passes.maxElevationTip', {
    elevation: props.entry.pass.max_elevation_deg.toFixed(1),
    tca: formatUtc(Date.parse(props.entry.pass.tca)).slice(11),
  }),
)

const flags = computed(() => {
  const pass = props.entry.pass
  const notes = [
    pass.clipped_start || pass.clipped_end
      ? t('passes.clipped')
      : pass.partial
        ? t('passes.spansWindow')
        : '',
    pass.mask_limited ? t('passes.masked') : '',
    pass.conflict_with.length ? t('passes.conflicts', { count: pass.conflict_with.length }) : '',
  ].filter(Boolean)
  return notes.length ? ` · ${notes.join(' · ')}` : ''
})

const visibilityText = computed(() => {
  const pass = props.entry.pass
  if (pass.visible) return t('passes.visibility.visible')
  return t(pass.satellite_sunlit ? 'passes.visibility.sunlit' : 'passes.visibility.eclipsed')
})
</script>

<style scoped>
.pass-row {
  gap: 6px;
  padding: 6px 8px 6px 2px;
}
.pass-row.rejected {
  opacity: 0.6;
}
.dropped {
  flex: none;
  font-size: 10.5px;
  font-weight: 700;
  color: rgb(var(--v-theme-error));
}
.satellite {
  display: block;
  overflow: hidden;
  font-size: 11.5px;
  color: rgb(var(--v-theme-secondary));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pass-row.muted {
  opacity: 0.55;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.number {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.station {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.live-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-success), 0.25);
}
.times {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.times small {
  font-size: 10px;
  font-weight: 700;
  color: rgb(var(--v-theme-secondary));
}
.duration {
  font-size: 12.5px;
  color: rgb(var(--v-theme-primary));
}
.grow > small {
  display: block;
}
.elevation {
  display: grid;
  min-width: 46px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.1;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.elevation small {
  font-size: 9.5px;
  font-weight: 500;
  color: rgb(var(--v-theme-secondary));
  white-space: nowrap;
}
</style>
