<template>
  <v-card ref="root" class="dashboard-card glass glass--clear timeline">
    <div class="timeline__row">
      <v-btn
        icon
        size="small"
        variant="tonal"
        color="primary"
        :aria-label="clock.playing ? t('app.clock.pause') : t('app.clock.play')"
        @click="clock.setPlaying(!clock.playing)"
      >
        <component :is="clock.playing ? Pause : Play" :size="16" />
      </v-btn>
      <v-menu v-model="speedMenuOpen" location="top">
        <template #activator="{ props }">
          <v-btn v-bind="props" size="small" variant="outlined" class="speed">
            <Gauge :size="14" class="mr-1" aria-hidden="true" />{{ clock.multiplier }}×
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="speed in speeds"
            :key="speed"
            :active="clock.multiplier === speed"
            color="primary"
            @click="clock.setMultiplier(speed)"
          >
            <v-list-item-title>{{ speed }}×</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <div class="clock-text">
        <strong>{{ formatUtc(clock.currentMs) }} UTC</strong>
        <small class="muted">
          {{ localZoneLabel(clock.currentMs) }} {{ formatLocal(clock.currentMs) }}
        </small>
      </div>
      <v-spacer />
      <small v-if="clock.bounded" class="muted range">
        {{ formatUtc(clock.startMs, false) }} → {{ formatUtc(clock.stopMs, false) }}
      </small>
      <v-btn size="small" variant="text" @click="clock.goLive()">
        <LocateFixed :size="14" class="mr-1" aria-hidden="true" />{{ t('app.clock.now') }}
      </v-btn>
      <v-btn
        icon
        size="x-small"
        variant="text"
        data-testid="clock-pin"
        :aria-pressed="ui.clockPinned"
        :aria-label="t(ui.clockPinned ? 'app.dock.unpin' : 'app.dock.pin')"
        :title="t(ui.clockPinned ? 'app.dock.unpin' : 'app.dock.pin')"
        @click="ui.clockPinned = !ui.clockPinned"
      >
        <component :is="ui.clockPinned ? PinOff : Pin" :size="15" />
      </v-btn>
    </div>
    <v-slider
      class="clock-slider"
      :class="{ 'clock-slider--bands': trustGradient !== 'none' || eclipseBands !== 'none' }"
      :style="{
        '--trust-bands': trustGradient,
        '--eclipse-bands': eclipseBands,
        '--band-share': trustGradient !== 'none' && eclipseBands !== 'none' ? 0.5 : 1,
      }"
      data-testid="clock-slider"
      :model-value="clock.currentMs"
      :min="clock.startMs"
      :max="clock.stopMs"
      :step="1000"
      color="primary"
      track-color="rgba(127,127,127,0.35)"
      hide-details
      density="compact"
      thumb-size="14"
      :aria-label="t('app.clock.slider')"
      @update:model-value="clock.seek"
    />
  </v-card>
</template>

<script setup lang="ts">
import { Gauge, LocateFixed, Pause, Pin, PinOff, Play } from 'lucide-vue-next'
import { type ComponentPublicInstance, computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { eclipseGradient } from '../orbit/eclipse'
import { bandsGradient } from '../orbit/epochTrust'
import { useEclipse } from '../orbit/useEclipse'
import { useEpochTrust } from '../orbit/useEpochTrust'
import { useClockStore } from '../stores/clock'
import { useLayersStore } from '../stores/layers'
import { useUiStore } from '../stores/ui'
import { useThemePreset } from '../theme/useThemePreset'
import { formatLocal, formatUtc, localZoneLabel } from '../utils/time'

const speeds = [1, 10, 60, 300, 1000, 3600]
const { t } = useI18n()
const clock = useClockStore()
const ui = useUiStore()
const root = ref<ComponentPublicInstance | null>(null)
const speedMenuOpen = ref(false)
const theme = useThemePreset()
const trust = useEpochTrust()
/** Shades the stretches of the range where the followed run's elements are getting old. */
const trustGradient = computed(() =>
  bandsGradient(trust.bands.value, clock.startMs, clock.stopMs, theme.preset.globe.trust),
)
const layers = useLayersStore()
const eclipse = useEclipse()
/** Marks the stretches of the range the followed run spends in the Earth's shadow. */
const eclipseBands = computed(() =>
  layers.prefs.showEclipse && eclipse.intervalsMs.value
    ? eclipseGradient(
        eclipse.intervalsMs.value,
        clock.startMs,
        clock.stopMs,
        theme.preset.globe.eclipse.band,
      )
    : 'none',
)

// The menu is teleported out of the bar, so moving onto it counts as leaving a popped-up bar.
// Hold the bar while the menu is open, then let it drop once the pointer is off the bar.
watch(speedMenuOpen, (open) => {
  if (open) return ui.peek.hold()
  ui.peek.release()
  if (!(root.value?.$el as HTMLElement | undefined)?.matches(':hover')) ui.peek.leave()
})
onBeforeUnmount(() => {
  if (speedMenuOpen.value) ui.peek.release()
})
</script>

<style scoped>
.timeline {
  padding: 8px 14px 2px;
}
.timeline__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.speed {
  min-width: 70px;
  font-variant-numeric: tabular-nums;
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.clock-text {
  display: grid;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.clock-text strong {
  font-size: 13.5px;
}
.clock-text small,
.range {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
/*
 * Element-age shading (orbit/epochTrust.ts) and eclipses (orbit/eclipse.ts) on the slider
 * track: each takes the full height alone, or the top and bottom half when both show.
 */
.clock-slider--bands :deep(.v-slider-track__background) {
  background-image: var(--trust-bands);
  background-repeat: no-repeat;
  background-size: 100% calc(100% * var(--band-share));
  opacity: 1;
}
.clock-slider--bands :deep(.v-slider-track) {
  --v-slider-track-size: 6px;
  position: relative;
}
/* Eclipses sit over the fill, so the part of the range already played keeps its marks. */
.clock-slider--bands :deep(.v-slider-track)::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: calc(50% - var(--v-slider-track-size) / 2);
  left: 0;
  height: calc(var(--v-slider-track-size) * var(--band-share));
  border-radius: inherit;
  background-image: var(--eclipse-bands);
  pointer-events: none;
}
/* The dock narrows to the gap between the side panels; the range is the first to go. */
@container (max-width: 640px) {
  .range {
    display: none;
  }
}
</style>
