<template>
  <div class="links">
    <div
      v-for="row in rows"
      :key="row.station.id"
      class="link"
      :data-mode="row.mode"
      data-testid="storage-station"
    >
      <span class="name">{{ row.name }}</span>
      <v-btn-toggle
        :model-value="row.mode"
        class="segmented"
        :aria-label="t('missionStorage.station.mode', { name: row.name })"
        @update:model-value="(mode: StationMode) => setStationMode(settings, row.station.id, mode)"
      >
        <v-btn v-for="mode in MODES" :key="mode" :value="mode">
          {{ t(`missionStorage.station.${mode}`) }}
        </v-btn>
      </v-btn-toggle>
      <v-text-field
        :model-value="row.rate"
        type="number"
        hide-details
        persistent-placeholder
        :min="STATION_RATE_LIMITS[0]"
        :max="STATION_RATE_LIMITS[1]"
        :placeholder="row.bandRate"
        :disabled="row.mode === 'off'"
        :aria-label="t('missionStorage.station.rate', { name: row.name })"
        @update:model-value="(value: string) => setRate(row.station.id, value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '../i18n/useLocale'
import {
  setStationMode,
  setStationRate,
  STATION_RATE_LIMITS,
  stationLink,
  storageValue,
  type StationMode,
} from '../mission/storage'
import { stationLabel } from '../stations/presets'
import { useMissionStore } from '../stores/mission'
import { useStorageStore } from '../stores/storage'

const MODES: readonly StationMode[] = ['off', 's', 'x']

/**
 * One row per station of the pass prediction: whether it takes payload data, in which band,
 * and its own rate when it differs from the rate of that band.
 */
const { t } = useI18n()
const locale = useLocaleStore()
const storage = useStorageStore()
const settings = useMissionStore().saved.storage

const rows = computed(() =>
  storage.planStations.map((station) => {
    const link = stationLink(settings, station.id)
    const own = settings.stationLinks.find((item) => item.stationId === station.id)?.rateMbps
    return {
      station,
      name: stationLabel(station, locale.locale),
      mode: (link.on ? link.band : 'off') as StationMode,
      rate: own ?? '',
      bandRate: String(storageValue(settings, link.band === 's' ? 'sMbps' : 'xMbps')),
    }
  }),
)

/** An empty field goes back to the rate of the band; a half-typed one changes nothing. */
function setRate(stationId: number, value: string) {
  const rate = Number(value)
  if (value === '' || value === null) setStationRate(settings, stationId, null)
  else if (rate >= STATION_RATE_LIMITS[0] && rate <= STATION_RATE_LIMITS[1])
    setStationRate(settings, stationId, rate)
}
</script>

<style scoped>
.links {
  display: grid;
  gap: var(--space-2);
}
.link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px 96px;
  align-items: center;
  gap: var(--space-2);
}
.name {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
