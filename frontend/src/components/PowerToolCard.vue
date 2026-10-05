<template>
  <DashboardCard :title="t('app.tool.power.label')" eyebrow="POWER" :icon="BatteryCharging" fill>
    <template #append>
      <InfoTip :label="t('missionPower.about')" data-testid="power-about">
        <ul class="tip-list">
          <li v-for="note in NOTES" :key="note">{{ t(`missionPower.notes.${note}`) }}</li>
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
            :aria-label="t('missionPower.settings')"
            data-testid="power-settings-open"
          >
            <Settings2 :size="15" class="mr-1" aria-hidden="true" />{{
              t('missionPower.settingsShort')
            }}
          </v-btn>
        </template>
        <v-card class="glass" width="420">
          <v-card-text class="form-stack">
            <p class="eyebrow">{{ t('missionPower.settings') }}</p>
            <PowerSettingsForm />
          </v-card-text>
        </v-card>
      </v-menu>
    </template>
    <PowerPanel />
  </DashboardCard>
</template>

<script setup lang="ts">
import { BatteryCharging, Settings2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import DashboardCard from './DashboardCard.vue'
import InfoTip from './InfoTip.vue'
import PowerPanel from './PowerPanel.vue'
import PowerSettingsForm from './PowerSettingsForm.vue'

/** What the model assumes and leaves out, shown from the info icon. */
const NOTES = ['array', 'imaging', 'eclipse', 'battery', 'circuit', 'chart'] as const

/**
 * The card shows the battery over the run; the array, battery and loads it is computed from
 * open from the gear in the heading, beside the globe, so the chart stays in view.
 */
const { t } = useI18n()
</script>

<style scoped>
.settings-button {
  margin-left: var(--space-2);
}
</style>
