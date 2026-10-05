<template>
  <div v-if="icons.length" class="dock-tray" role="toolbar" :aria-label="t('app.dockTray')">
    <v-tooltip v-for="icon in icons" :key="icon.piece" :text="icon.label" location="top">
      <template #activator="{ props }">
        <button
          v-bind="props"
          type="button"
          class="tray-button glass-chip"
          :class="{ 'tray-button--open': ui.dockPeek === icon.piece }"
          :data-testid="icon.testId"
          :aria-label="icon.label"
          :aria-expanded="ui.dockPeek === icon.piece"
          @mouseenter="ui.peek.enter(icon.piece)"
          @mouseleave="ui.peek.leave()"
          @focus="ui.peek.enter(icon.piece)"
          @blur="ui.peek.leave()"
          @click="ui.peek.enter(icon.piece)"
          @keydown.esc="ui.peek.close()"
        >
          <component :is="icon.icon" :size="17" aria-hidden="true" />
          <span
            v-if="icon.piece === 'clock' && clock.playing"
            class="tray-button__live"
            aria-hidden="true"
          />
        </button>
      </template>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { ChartGantt, Clock } from 'lucide-vue-next'
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useClockStore } from '../stores/clock'
import { useUiStore, type DockPiece } from '../stores/ui'
import { formatUtc } from '../utils/time'

/**
 * Round icons at the dock's left end for the pieces that are not pinned. Hovering or focusing
 * one pops its piece up over the dock (`ui.dockPeek`); the piece's pin keeps it there.
 */
const props = defineProps<{ timelineAvailable: boolean }>()

const { t } = useI18n()
const ui = useUiStore()
const clock = useClockStore()

interface TrayIcon {
  piece: DockPiece
  icon: Component
  label: string
  testId: string
}

// A click (or a tap, where there is no hover) opens the piece too; leaving closes it.
const icons = computed(() => {
  const list: TrayIcon[] = []
  if (props.timelineAvailable && !ui.timelinePinned) {
    list.push({
      piece: 'timeline',
      icon: ChartGantt,
      label: t('passes.timelineIcon'),
      testId: 'tray-pass-timeline',
    })
  }
  if (!ui.clockPinned) {
    list.push({
      piece: 'clock',
      icon: Clock,
      label: t('app.clock.icon', { time: formatUtc(clock.currentMs) }),
      testId: 'tray-clock',
    })
  }
  return list
})
</script>

<style scoped>
.tray-button {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 50%;
  background: rgba(var(--v-theme-surface), var(--lg-alpha, 0.8));
  backdrop-filter: var(--lg-fallback);
  -webkit-backdrop-filter: var(--lg-fallback);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}
.tray-button:hover,
.tray-button--open {
  border-color: rgba(var(--v-theme-primary), 0.45);
  color: rgb(var(--v-theme-primary));
}
.tray-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
/* The clock is running while it sits as an icon. */
.tray-button__live {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
}
</style>
