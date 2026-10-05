<template>
  <v-menu v-model="ui.helpOpen" location="bottom end" :close-on-content-click="false">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        variant="outlined"
        class="help-button"
        :aria-label="t('app.help.open')"
        :title="`${t('app.help.open')} (?)`"
      >
        <Keyboard :size="16" aria-hidden="true" />
      </v-btn>
    </template>
    <v-card class="help-card glass" min-width="340">
      <v-card-text class="form-stack">
        <p class="eyebrow">{{ t('app.help.title') }}</p>
        <template v-for="section in sections" :key="section.title">
          <p class="section-label">{{ t(section.title) }}</p>
          <dl class="help-list">
            <template v-for="row in section.rows" :key="row.action">
              <dt>
                <kbd>{{ t(row.keys) }}</kbd>
              </dt>
              <dd>{{ t(row.action) }}</dd>
            </template>
          </dl>
        </template>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { Keyboard } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const ui = useUiStore()

// Keyboard rows mirror `utils/hotkeys.ts`; mouse rows are Cesium's defaults plus `globe/picking.ts`.
const sections = [
  {
    title: 'app.help.keyboard',
    rows: [
      { keys: 'app.help.keys.space', action: 'app.help.togglePlay' },
      { keys: 'app.help.keys.esc', action: 'app.help.deselect' },
      { keys: 'app.help.keys.home', action: 'app.help.home' },
      { keys: 'app.help.keys.sceneMode', action: 'app.help.toggleSceneMode' },
      { keys: 'app.help.keys.left', action: 'app.help.toggleLeft' },
      { keys: 'app.help.keys.bottom', action: 'app.help.toggleBottom' },
      { keys: 'app.help.keys.question', action: 'app.help.toggleHelp' },
    ],
  },
  {
    title: 'app.help.mouse',
    rows: [
      { keys: 'app.help.keys.clickOrbit', action: 'app.help.clickOrbit' },
      { keys: 'app.help.keys.doubleClickMarker', action: 'app.help.trackMarker' },
      { keys: 'app.help.keys.clickStation', action: 'app.help.clickStation' },
      { keys: 'app.help.keys.clickPoint', action: 'app.help.clickPoint' },
      { keys: 'app.help.keys.leftDrag', action: 'app.help.rotate' },
      { keys: 'app.help.keys.wheel', action: 'app.help.zoom' },
      { keys: 'app.help.keys.tilt', action: 'app.help.tilt' },
      { keys: 'app.help.keys.look', action: 'app.help.look' },
    ],
  },
]
</script>

<style scoped>
.help-button {
  min-width: 34px !important;
  height: 34px !important;
  margin-right: 8px;
  padding: 0 !important;
  border-color: rgba(var(--v-theme-on-surface), 0.15);
}
.help-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 7px 14px;
  align-items: center;
  margin: 0;
  font-size: 13px;
}
.help-list dd {
  margin: 0;
}
kbd {
  display: inline-block;
  padding: 2px 7px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
</style>
