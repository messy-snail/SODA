<template>
  <DashboardCard :title="t('app.tool.imaging.label')" eyebrow="IMAGING" :icon="Aperture" fill>
    <template #append><ImagingOptionsButton /></template>
    <v-tabs
      v-model="ui.imagingTab"
      class="imaging-tabs"
      density="compact"
      grow
      color="primary"
      data-testid="imaging-tabs"
    >
      <v-tab
        v-for="tab in IMAGING_TABS"
        :key="tab"
        :value="tab"
        :data-testid="`imaging-tab-${tab}`"
      >
        {{ label(tab) }}
      </v-tab>
    </v-tabs>
    <ImagingPanel />
  </DashboardCard>
</template>

<script setup lang="ts">
import { Aperture } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useMissionStore } from '../stores/mission'
import { IMAGING_TABS, useUiStore, type ImagingTab } from '../stores/ui'
import DashboardCard from './DashboardCard.vue'
import ImagingOptionsButton from './ImagingOptionsButton.vue'
import ImagingPanel from './ImagingPanel.vue'

/**
 * What to image and when it can be imaged are two tabs, so the search button is never
 * followed by a long list: the targets fit the panel, and the opportunities scroll alone.
 */
const { t } = useI18n()
const ui = useUiStore()
const mission = useMissionStore()

/** The results tab counts the opportunities once a search has answered. */
function label(tab: ImagingTab) {
  return tab === 'results' && mission.results.length
    ? t('mission.access.tab.resultsCount', { count: mission.shots.length })
    : t(`mission.access.tab.${tab}`)
}
</script>

<style scoped>
.imaging-tabs {
  margin: -4px 0 var(--space-2);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.imaging-tabs :deep(.v-tab) {
  min-width: 0;
  padding-inline: var(--space-2);
}
</style>
