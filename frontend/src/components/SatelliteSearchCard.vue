<template>
  <DashboardCard :title="t('catalog.pickTitle')" eyebrow="CATALOG" :icon="Satellite">
    <div class="form-stack">
      <SatelliteBasketTray />
      <v-btn-toggle
        v-model="tab"
        class="segmented"
        :aria-label="t('catalog.pickTitle')"
        data-testid="satellite-tabs"
      >
        <v-btn v-for="item in tabs" :key="item.id" :value="item.id" :data-testid="`tab-${item.id}`">
          <component :is="item.icon" :size="14" class="mr-1" aria-hidden="true" />{{ item.title }}
        </v-btn>
      </v-btn-toggle>
      <KeepAlive>
        <SatelliteSearchTab v-if="tab === 'search'" />
        <CustomElementsTab v-else />
      </KeepAlive>
      <v-btn
        color="primary"
        block
        class="to-propagate"
        :disabled="!basket.items.length"
        data-testid="to-propagate"
        @click="ui.openSatelliteStep('propagate')"
      >
        <Orbit :size="16" class="mr-2" aria-hidden="true" />
        {{ t('catalog.propagatePicked', { count: basket.items.length }) }}
      </v-btn>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { FilePlus2, Orbit, Satellite, Search } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useUiStore } from '../stores/ui'
import CustomElementsTab from './CustomElementsTab.vue'
import DashboardCard from './DashboardCard.vue'
import SatelliteBasketTray from './SatelliteBasketTray.vue'
import SatelliteSearchTab from './SatelliteSearchTab.vue'

type Tab = 'search' | 'custom'
const TAB_KEY = 'soda.satelliteTab'

const { t } = useI18n()
const ui = useUiStore()
const basket = useSatelliteBasketStore()

function storedTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'custom' ? 'custom' : 'search'
  } catch {
    return 'search'
  }
}
const tab = ref<Tab>(storedTab())
watch(tab, (value) => {
  try {
    localStorage.setItem(TAB_KEY, value)
  } catch {
    /* Session only. */
  }
})

const tabs = computed(() => [
  { id: 'search' as const, title: t('catalog.tabs.search'), icon: Search },
  { id: 'custom' as const, title: t('catalog.tabs.custom'), icon: FilePlus2 },
])
</script>

<style scoped>
/* The way on stays in reach at the foot of the panel while the lists scroll above it. */
.to-propagate {
  position: sticky;
  bottom: 0;
  z-index: 1;
  box-shadow: 0 -8px 16px rgba(var(--v-theme-surface), 0.9);
}
</style>
