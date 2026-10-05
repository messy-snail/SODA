<template>
  <div class="frame-overlay">
    <div v-if="runs.selectedRun" class="selection-chip glass-chip" data-testid="selection-chip">
      <MousePointerClick :size="13" aria-hidden="true" />
      <span class="selection-chip__label">{{ t('app.selectionChip.label') }}</span>
      <strong class="selection-chip__name">{{ runs.selectedRun.name }}</strong>
      <span class="selection-chip__hint">{{ t('app.selectionChip.hint') }}</span>
      <button
        type="button"
        class="selection-chip__clear"
        :aria-label="t('app.selectionChip.clear')"
        :title="t('app.selectionChip.clear')"
        @click="runs.select(null)"
      >
        <X :size="12" aria-hidden="true" />
      </button>
    </div>
    <div
      v-if="layers.prefs.showEclipse && eclipse.eclipsedNow.value"
      class="eclipse-chip glass-chip"
      data-testid="eclipse-chip"
      :title="t('app.eclipseChip.hint', { name: eclipse.reference.value?.name ?? '' })"
    >
      <Moon :size="13" aria-hidden="true" />
      <span>{{ t('app.eclipseChip.label') }}</span>
    </div>
    <button
      type="button"
      class="frame-pill glass-chip"
      :class="{ 'is-inertial': inertial }"
      data-testid="frame-pill"
      :disabled="is2d"
      :aria-label="frameTitle"
      :title="frameTitle"
      @click="layers.requestFrame(inertial ? 'fixed' : 'inertial')"
    >
      <v-progress-circular
        v-if="layers.frameState.loading"
        indeterminate
        :size="11"
        :width="2"
        aria-hidden="true"
      />
      <component :is="inertial ? Orbit : Globe2" v-else :size="13" aria-hidden="true" />
      <span>{{ inertial ? 'ECI' : 'ECEF' }}</span>
      <ArrowLeftRight v-if="!is2d" :size="11" class="frame-pill__swap" aria-hidden="true" />
    </button>
    <div class="view-buttons">
      <button
        type="button"
        class="view-button glass-chip"
        data-testid="home-view"
        :aria-label="t('app.view.home')"
        :title="t('app.view.home')"
        @click="ui.goHome()"
      >
        <House :size="15" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="view-button glass-chip"
        data-testid="scene-mode"
        :aria-label="t(is2d ? 'app.view.to3d' : 'app.view.to2d')"
        :title="t(is2d ? 'app.view.to3d' : 'app.view.to2d')"
        @click="ui.toggleSceneMode()"
      >
        <component :is="is2d ? Globe2 : MapIcon" :size="15" aria-hidden="true" />
        <span>{{ is2d ? '3D' : '2D' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowLeftRight,
  Globe2,
  House,
  Map as MapIcon,
  Moon,
  MousePointerClick,
  Orbit,
  X,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useEclipse } from '../orbit/useEclipse'
import { useLayersStore } from '../stores/layers'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const layers = useLayersStore()
const runs = useRunsStore()
const ui = useUiStore()
const eclipse = useEclipse()
const inertial = computed(() => layers.effectiveFrame === 'inertial')
const is2d = computed(() => ui.sceneMode === '2d')
const frameTitle = computed(() => {
  if (is2d.value) return t('propagate.runs.frameLocked2d')
  const view = t(inertial.value ? 'propagate.runs.inertialView' : 'propagate.runs.fixedView')
  const action = t(
    inertial.value ? 'propagate.runs.switchToFixed' : 'propagate.runs.switchToInertial',
  )
  return `${view} · ${action}`
})
</script>

<style scoped>
.frame-overlay {
  position: absolute;
  top: calc(var(--frame-top, 0px) + 14px);
  /* Beside the swath inspector (or its edge tab) while a run is selected; see styles.css. */
  right: var(--right-edge, 14px);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - var(--right-edge, 14px) - 14px);
  pointer-events: none;
}
.frame-pill,
.eclipse-chip,
.selection-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), var(--lg-alpha, 0.8));
  backdrop-filter: var(--lg-fallback);
  font-size: 11px;
}
.frame-pill {
  --frame-color: var(--v-theme-frame-fixed);
  flex: none;
  padding: 3px 9px;
  border: 1px solid rgb(var(--frame-color));
  color: rgb(var(--frame-color));
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  pointer-events: auto;
}
.frame-pill:hover:not(:disabled),
.frame-pill:focus-visible {
  background: rgba(var(--frame-color), 0.14);
}
.frame-pill:disabled {
  cursor: default;
}
.frame-pill__swap {
  opacity: 0.7;
}
.frame-pill.is-inertial {
  --frame-color: var(--v-theme-frame-inertial);
}
.eclipse-chip {
  flex: none;
  padding: 3px 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3);
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-weight: 700;
  pointer-events: auto;
}
.selection-chip {
  min-width: 0;
  padding: 2px 3px 2px 9px;
  border: 1px solid rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-surface));
  pointer-events: auto;
}
.selection-chip > svg,
.selection-chip__label {
  flex: none;
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}
.selection-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selection-chip__hint {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.selection-chip__hint::before {
  content: '·';
  margin-right: 5px;
}
.selection-chip__clear {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: inherit;
  cursor: pointer;
}
.selection-chip__clear:hover,
.selection-chip__clear:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.12);
}
.view-buttons {
  display: inline-flex;
  flex: none;
  gap: 4px;
  pointer-events: auto;
}
.view-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  min-width: 26px;
  justify-content: center;
  padding: 0 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), var(--lg-alpha, 0.8));
  backdrop-filter: var(--lg-fallback);
  color: rgb(var(--v-theme-on-surface));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.view-button:hover,
.view-button:focus-visible {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
@media (max-width: 1200px) {
  .selection-chip__hint {
    display: none;
  }
}
</style>
