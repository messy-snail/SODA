<template>
  <DashboardCard :title="t('app.tool.view.label')" eyebrow="VIEW" :icon="Layers" fill>
    <v-tabs
      v-model="ui.viewTab"
      class="view-tabs"
      density="compact"
      grow
      color="primary"
      data-testid="view-tabs"
    >
      <v-tab v-for="tab in VIEW_TABS" :key="tab" :value="tab" :data-testid="`view-tab-${tab}`">
        {{ t(`app.viewTab.${tab}`) }}
      </v-tab>
    </v-tabs>
    <LayersCard v-if="ui.viewTab === 'layers'" />
    <ImageryCard v-else-if="ui.viewTab === 'imagery'" />
    <template v-else-if="ui.viewTab === 'places'">
      <PlaceSearchCard />
      <PinsCard />
      <HomeViewCard />
    </template>
    <SatelliteMarkerCard v-else />
  </DashboardCard>
</template>

<script setup lang="ts">
import { Layers } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUiStore, VIEW_TABS } from '../stores/ui'
import DashboardCard from './DashboardCard.vue'
import HomeViewCard from './HomeViewCard.vue'
import ImageryCard from './ImageryCard.vue'
import LayersCard from './LayersCard.vue'
import PinsCard from './PinsCard.vue'
import PlaceSearchCard from './PlaceSearchCard.vue'
import SatelliteMarkerCard from './SatelliteMarkerCard.vue'

/**
 * Layers, user imagery, places and satellite markers share one panel: all of them decide how
 * the globe looks, and switching tabs is quicker than hopping between rail tools. Each tab keeps its
 * own card, which renders as a plain section inside this one.
 */
const { t } = useI18n()
const ui = useUiStore()
</script>

<style scoped>
.view-tabs {
  margin: -4px 0 4px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
/* Four tabs share the panel width; Vuetify's 90 px minimum would push the last one off. */
.view-tabs :deep(.v-tab) {
  min-width: 0;
  padding-inline: var(--space-2);
}
</style>
