<template>
  <div
    class="list-row access-row"
    :class="{ selected: active }"
    role="button"
    tabindex="0"
    :aria-label="label"
    data-testid="access-row"
    @click="emit('pick', window.best_time)"
    @keydown.enter.self="emit('pick', window.best_time)"
  >
    <i v-if="color" class="swatch" :style="{ background: color }" aria-hidden="true" />
    <component :is="kindIcon" :size="14" class="kind muted" aria-hidden="true" />
    <span class="grow">
      <span class="head">
        <strong class="target">{{ targetName }}</strong>
        <span class="time">{{ best }}</span>
        <strong class="duration">{{
          window.duration_s > 0
            ? t('mission.access.duration', { seconds: seconds })
            : t('mission.access.instant')
        }}</strong>
      </span>
      <span v-if="satelliteName" class="satellite">{{ satelliteName }}</span>
      <small>
        {{ t('mission.access.offNadir', { angle: window.min_off_nadir_deg.toFixed(1) }) }} ·
        {{ t('mission.access.sun', { elevation: window.target_sun_elev_deg.toFixed(0) }) }} ·
        {{ t(window.ascending ? 'mission.access.ascending' : 'mission.access.descending')
        }}{{ extra }}
      </small>
    </span>
    <span class="roll">
      {{ t('mission.access.roll', { roll: signed(window.roll_deg) }) }}
      <small v-if="pitch">{{
        t('mission.access.pitch', { pitch: signed(window.pitch_deg) })
      }}</small>
    </span>
  </div>
</template>

<script setup lang="ts">
import { MapPin, SquareDashed } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccessWindow } from '../api/types'
import { formatUtc } from '../utils/time'

const props = defineProps<{
  window: AccessWindow
  targetName: string
  box: boolean
  /** The result came from the roll and pitch model, so pitch is worth showing. */
  pitch: boolean
  /** The clock sits inside this window. */
  active: boolean
  /** Given when several satellites share the list, with the satellite's orbit colour. */
  satelliteName?: string
  color?: string
}>()
const emit = defineEmits<{ pick: [iso: string] }>()

const { t } = useI18n()

const kindIcon = computed(() => (props.box ? SquareDashed : MapPin))
const best = computed(() => formatUtc(Date.parse(props.window.best_time)).slice(5))
const seconds = computed(() => Math.round(props.window.duration_s))
const label = computed(() =>
  props.satelliteName
    ? t('mission.access.rowLabelSat', {
        satellite: props.satelliteName,
        target: props.targetName,
        time: best.value,
      })
    : t('mission.access.rowLabel', { target: props.targetName, time: best.value }),
)
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`

const extra = computed(() => {
  const notes = [
    props.box
      ? t('mission.access.coverage', { percent: Math.round(props.window.coverage * 100) })
      : '',
    props.window.clipped_start || props.window.clipped_end ? t('mission.access.clipped') : '',
  ].filter(Boolean)
  return notes.length ? ` · ${notes.join(' · ')}` : ''
})
</script>

<style scoped>
.access-row {
  gap: 8px;
  padding: 6px 8px;
}
.kind {
  flex: none;
}
.swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.satellite {
  display: block;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time,
.duration {
  flex: none;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.duration {
  color: rgb(var(--v-theme-primary));
}
.grow > small {
  display: block;
}
.roll {
  display: grid;
  flex: none;
  min-width: 64px;
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.roll small {
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--v-theme-secondary));
}
</style>
