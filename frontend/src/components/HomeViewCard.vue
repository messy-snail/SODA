<template>
  <DashboardCard
    section-id="places.home"
    :title="t('places.home.title')"
    eyebrow="HOME"
    :icon="House"
  >
    <div class="form-stack">
      <p class="muted text-caption">{{ t('places.home.hint') }}</p>
      <div class="form-pair">
        <v-text-field
          v-model.number="home.lat_deg"
          type="number"
          :label="t('places.home.latitude')"
          data-testid="home-lat"
        />
        <v-text-field
          v-model.number="home.lon_deg"
          type="number"
          :label="t('places.home.longitude')"
          data-testid="home-lon"
        />
        <v-text-field
          v-model.number="home.height_km"
          type="number"
          :label="t('places.home.height')"
          data-testid="home-height"
        />
      </div>
      <div class="actions">
        <v-btn variant="text" size="small" @click="places.resetHome()">
          {{ t('places.home.reset') }}
        </v-btn>
        <v-btn variant="text" size="small" @click="places.requestHomeCapture()">
          {{ t('places.home.useCurrent') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          size="small"
          :disabled="!valid"
          data-testid="home-apply"
          @click="apply"
        >
          {{ t('places.home.apply') }}
        </v-btn>
      </div>
      <v-btn variant="outlined" size="small" @click="ui.goHome()">
        <House :size="14" class="mr-1" aria-hidden="true" />{{ t('places.home.go') }}
      </v-btn>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { House } from 'lucide-vue-next'
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MAX_HEIGHT_M, MIN_HEIGHT_M } from '../places/camera'
import { usePlacesStore } from '../stores/places'
import { useUiStore } from '../stores/ui'
import DashboardCard from './DashboardCard.vue'

const { t } = useI18n()
const places = usePlacesStore()
const ui = useUiStore()

/** The form edits a copy in km; the stored home only changes on Apply. */
const home = reactive({ lat_deg: 0, lon_deg: 0, height_km: 0 })
watch(
  () => places.saved.home,
  (saved) => {
    home.lat_deg = +saved.lat_deg.toFixed(4)
    home.lon_deg = +saved.lon_deg.toFixed(4)
    home.height_km = Math.round(saved.height_m / 1000)
  },
  { immediate: true, deep: true },
)

const inRange = (value: number, low: number, high: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high

const valid = computed(
  () =>
    inRange(home.lat_deg, -90, 90) &&
    inRange(home.lon_deg, -180, 180) &&
    inRange(home.height_km, MIN_HEIGHT_M / 1000, MAX_HEIGHT_M / 1000),
)

function apply() {
  if (!valid.value) return
  places.setHome({ lat_deg: home.lat_deg, lon_deg: home.lon_deg, height_m: home.height_km * 1000 })
  ui.goHome()
}
</script>

<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}
</style>
