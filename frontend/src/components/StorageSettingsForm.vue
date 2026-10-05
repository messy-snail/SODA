<template>
  <div class="form-stack" data-testid="storage-settings">
    <template v-for="group in GROUPS" :key="group.id">
      <p class="section-label">{{ t(`missionStorage.groups.${group.id}`) }}</p>
      <div class="form-pair">
        <v-text-field
          v-for="field in group.fields"
          :key="field"
          v-model.number="settings[field]"
          type="number"
          :min="STORAGE_LIMITS[field][0]"
          :max="STORAGE_LIMITS[field][1]"
          :label="t(`missionStorage.fields.${field}`)"
        />
      </div>
    </template>

    <p class="section-label">{{ t('missionStorage.groups.playback') }}</p>
    <v-btn-toggle
      v-model="settings.playback"
      class="segmented"
      :aria-label="t('missionStorage.groups.playback')"
      data-testid="storage-playback"
    >
      <v-btn v-for="mode in PLAYBACKS" :key="mode" :value="mode">
        {{ t(`missionStorage.playback.${mode}`) }}
      </v-btn>
    </v-btn-toggle>
    <div
      v-if="settings.playback === 'priority'"
      class="chips"
      role="group"
      :aria-label="t('missionStorage.urgentTargets')"
      data-testid="storage-urgent"
    >
      <v-chip
        v-for="target in mission.saved.targets"
        :key="target.id"
        :color="urgent(target.id) ? 'warning' : undefined"
        :variant="urgent(target.id) ? 'tonal' : 'outlined'"
        :aria-pressed="urgent(target.id)"
        @click="toggleUrgent(target.id)"
      >
        <Zap v-if="urgent(target.id)" :size="12" class="mr-1" aria-hidden="true" />{{ target.name }}
      </v-chip>
      <span v-if="!mission.saved.targets.length" class="field-note">
        {{ t('missionStorage.noTargets') }}
      </span>
    </div>

    <template v-if="storage.planStations.length">
      <p class="section-label">{{ t('missionStorage.groups.stations') }}</p>
      <StorageStationLinks />
    </template>
  </div>
</template>

<script setup lang="ts">
import { Zap } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { PLAYBACKS, STORAGE_LIMITS, type StorageField } from '../mission/storage'
import { useMissionStore } from '../stores/mission'
import { useStorageStore } from '../stores/storage'
import StorageStationLinks from './StorageStationLinks.vue'

const GROUPS: { id: 'recorder' | 'link'; fields: StorageField[] }[] = [
  {
    id: 'recorder',
    fields: ['capacityGbit', 'initialGbit', 'imagingMbps', 'compressionRatio', 'shotS'],
  },
  { id: 'link', fields: ['xMbps', 'sMbps', 'xMinElevDeg', 'lockS'] },
]

/** Recorder, downlink, playback order and the link of each station of the pass prediction. */
const { t } = useI18n()
const mission = useMissionStore()
const storage = useStorageStore()
const settings = mission.saved.storage

const urgent = (id: string) => settings.urgentTargetIds.includes(id)

function toggleUrgent(id: string) {
  const ids = settings.urgentTargetIds
  settings.urgentTargetIds = urgent(id) ? ids.filter((item) => item !== id) : [...ids, id]
}
</script>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}
</style>
