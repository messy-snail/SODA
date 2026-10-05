<template>
  <nav class="tool-rail glass glass--frame" :aria-label="t('app.toolRail')">
    <div class="tool-rail__list">
      <v-tooltip
        v-for="tool in tools"
        :key="tool.id"
        :text="t(`app.tool.${tool.id}.label`)"
        location="right"
      >
        <template #activator="{ props }">
          <button
            v-bind="props"
            type="button"
            class="tool-link"
            :class="{ selected: ui.activeTool === tool.id }"
            :aria-pressed="ui.activeTool === tool.id"
            :aria-label="t(`app.tool.${tool.id}.label`)"
            @click="ui.toggleTool(tool.id)"
          >
            <component :is="tool.icon" :size="19" aria-hidden="true" />
            <span>{{ t(`app.tool.${tool.id}.short`) }}</span>
          </button>
        </template>
      </v-tooltip>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { tools, useUiStore } from '../stores/ui'

const { t } = useI18n()
const ui = useUiStore()
</script>
