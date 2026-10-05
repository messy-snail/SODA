<template>
  <DashboardCard :title="t('app.tool.storage.label')" eyebrow="STORAGE" :icon="HardDrive" fill>
    <template #append>
      <InfoTip :label="t('missionStorage.about')" data-testid="storage-about">
        <ul class="tip-list">
          <li v-for="note in NOTES" :key="note">{{ t(`missionStorage.notes.${note}`) }}</li>
        </ul>
      </InfoTip>
      <v-menu :close-on-content-click="false" location="end" :offset="20">
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            size="small"
            variant="tonal"
            color="primary"
            class="settings-button"
            :aria-label="t('missionStorage.settings')"
            data-testid="storage-settings-open"
          >
            <Settings2 :size="15" class="mr-1" aria-hidden="true" />{{
              t('missionStorage.settingsShort')
            }}
          </v-btn>
        </template>
        <v-card class="glass settings-card" width="400">
          <v-card-text class="form-stack">
            <p class="eyebrow">{{ t('missionStorage.settings') }}</p>
            <StorageSettingsForm />
          </v-card-text>
        </v-card>
      </v-menu>
    </template>
    <StoragePanel />
  </DashboardCard>
</template>

<script setup lang="ts">
import { HardDrive, Settings2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import DashboardCard from './DashboardCard.vue'
import InfoTip from './InfoTip.vue'
import StoragePanel from './StoragePanel.vue'
import StorageSettingsForm from './StorageSettingsForm.vue'

/** What the model assumes and leaves out, shown from the info icon. */
const NOTES = ['file', 'fit', 'playback', 'link', 'elevation', 'chart'] as const

/**
 * The card shows the recorder over the run; the recorder, the downlink and what each station
 * receives open from the gear in the heading, beside the globe, so the chart stays in view.
 */
const { t } = useI18n()
</script>

<style scoped>
.settings-button {
  margin-left: var(--space-2);
}
/* Eight stations make the form tall; on a short window it scrolls rather than leaving it. */
.settings-card {
  max-height: calc(100vh - 96px);
  overflow-y: auto;
}
</style>
