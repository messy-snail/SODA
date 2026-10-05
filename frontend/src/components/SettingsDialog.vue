<template>
  <v-dialog
    v-model="settings.open"
    :max-width="tab === 'browse' ? 1000 : 520"
    scrollable
    aria-labelledby="settings-title"
    data-testid="settings-dialog"
  >
    <v-card class="dashboard-card glass settings-card" elevation="0">
      <v-card-title class="card-heading">
        <span class="card-icon"><Settings :size="17" aria-hidden="true" /></span>
        <div>
          <p class="eyebrow">SETTINGS</p>
          <h2 id="settings-title">{{ t('settings.title') }}</h2>
        </div>
        <v-spacer />
        <v-btn
          icon
          size="x-small"
          variant="text"
          :aria-label="t('settings.close')"
          @click="settings.open = false"
        >
          <X :size="16" aria-hidden="true" />
        </v-btn>
      </v-card-title>
      <v-tabs v-model="tab" density="compact" color="primary" class="settings-tabs">
        <v-tab value="general" data-testid="settings-tab-general">
          {{ t('settings.tab.general') }}
        </v-tab>
        <v-tab value="database" data-testid="settings-tab-database">
          {{ t('settings.tab.database') }}
        </v-tab>
        <v-tab value="browse" data-testid="settings-tab-browse">
          {{ t('settings.tab.browse') }}
        </v-tab>
      </v-tabs>
      <v-card-text>
        <template v-if="tab === 'general'">
          <AppearanceSettings />
          <v-divider class="my-4" />
          <ResetSettings />
        </template>
        <DatabaseSettings v-else-if="tab === 'database'" />
        <DatabaseBrowser v-else />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { Settings, X } from 'lucide-vue-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/settings'
import AppearanceSettings from './AppearanceSettings.vue'
import DatabaseBrowser from './DatabaseBrowser.vue'
import DatabaseSettings from './DatabaseSettings.vue'
import ResetSettings from './ResetSettings.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const tab = ref<'general' | 'database' | 'browse'>('general')
</script>

<style scoped>
.settings-tabs {
  margin: 4px 16px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
</style>
