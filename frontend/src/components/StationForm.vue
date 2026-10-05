<template>
  <div class="form-stack station-form">
    <v-text-field v-model="draft.name" :label="t('stations.name')" />
    <div class="form-pair">
      <v-text-field v-model.number="draft.lat_deg" type="number" :label="t('stations.latitude')" />
      <v-text-field v-model.number="draft.lon_deg" type="number" :label="t('stations.longitude')" />
      <v-text-field v-model.number="draft.alt_m" type="number" :label="t('stations.altitude')" />
      <v-text-field
        v-model.number="draft.min_elev_deg"
        type="number"
        :label="t('stations.minElevation')"
      />
    </div>

    <div>
      <p class="section-label">{{ t('stations.maskSection') }}</p>
      <p class="muted text-caption mask-hint">
        {{ t('stations.maskHint') }}
      </p>
      <div v-for="(point, index) in draft.az_mask" :key="index" class="mask-row">
        <v-text-field v-model.number="point.az_deg" type="number" :label="t('stations.azimuth')" />
        <v-text-field
          v-model.number="point.min_elev_deg"
          type="number"
          :label="t('stations.minElevation')"
        />
        <v-btn
          icon
          size="small"
          variant="text"
          :aria-label="t('stations.removeMaskPoint')"
          @click="removePoint(index)"
        >
          <Trash2 :size="14" />
        </v-btn>
      </div>
      <v-btn
        size="small"
        variant="text"
        :disabled="draft.az_mask.length >= MAX_MASK_POINTS"
        @click="addPoint"
      >
        <Plus :size="14" class="mr-1" aria-hidden="true" />{{ t('stations.addMaskPoint') }}
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
    <div class="actions">
      <v-btn variant="text" @click="emit('cancel')">{{ t('common.cancel') }}</v-btn>
      <v-btn color="primary" variant="tonal" :disabled="!valid" :loading="saving" @click="save">
        {{ station ? t('stations.update') : t('stations.create') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { AzMaskPoint, Station, StationInput } from '../api/types'
import { useLocaleStore } from '../i18n/useLocale'
import { presetOf, stationLabel } from '../stations/presets'
import { usePassesStore } from '../stores/passes'

/** Matches MAX_MASK_POINTS in src/soda/orbit/horizon.py. */
const MAX_MASK_POINTS = 72

const props = defineProps<{ station?: Station | null }>()
const emit = defineEmits<{ cancel: []; saved: [] }>()

const { t } = useI18n()
const passes = usePassesStore()
const locale = useLocaleStore()
const saving = ref(false)
const error = ref('')

function blank(): StationInput & { az_mask: AzMaskPoint[] } {
  return { name: '', lat_deg: 0, lon_deg: 0, alt_m: 0, min_elev_deg: 10, az_mask: [] }
}

/** The name as the list shows it, so a catalogue station opens in the reader's language. */
const shownName = props.station ? stationLabel(props.station, locale.locale) : ''

const draft = reactive(
  props.station
    ? {
        name: shownName,
        lat_deg: props.station.lat_deg,
        lon_deg: props.station.lon_deg,
        alt_m: props.station.alt_m,
        min_elev_deg: props.station.min_elev_deg,
        // Copy, so cancelling leaves the stored mask untouched.
        az_mask: props.station.az_mask.map((point) => ({ ...point })),
      }
    : blank(),
)

const inRange = (value: number, low: number, high: number) =>
  Number.isFinite(value) && value >= low && value <= high

const valid = computed(
  () =>
    draft.name.trim().length > 0 &&
    inRange(draft.lat_deg, -90, 90) &&
    inRange(draft.lon_deg, -180, 180) &&
    inRange(draft.alt_m, -500, 9000) &&
    inRange(draft.min_elev_deg, 0, 89) &&
    draft.az_mask.length !== 1 &&
    draft.az_mask.every(
      (point) =>
        Number.isFinite(point.az_deg) &&
        point.az_deg >= 0 &&
        point.az_deg < 360 &&
        inRange(point.min_elev_deg, 0, 89),
    ) &&
    new Set(draft.az_mask.map((point) => point.az_deg)).size === draft.az_mask.length,
)

function addPoint() {
  const last = draft.az_mask.at(-1)
  draft.az_mask.push({
    az_deg: last ? Math.min(last.az_deg + 45, 359) : 0,
    min_elev_deg: draft.min_elev_deg,
  })
}

function removePoint(index: number) {
  draft.az_mask.splice(index, 1)
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const name = draft.name.trim()
    // Renaming a catalogue station makes the name the reader's own, so it leaves the
    // catalogue. Otherwise the link stays, and a row saved before links existed gains one.
    const preset = props.station && name === shownName ? presetOf(props.station) : null
    const input: StationInput = {
      ...draft,
      name: preset && props.station ? props.station.name : name,
      preset_id: preset?.id ?? null,
      az_mask: [...draft.az_mask].sort((a, b) => a.az_deg - b.az_deg),
    }
    await (props.station ? passes.saveStation(props.station.id, input) : passes.addStation(input))
    emit('saved')
  } catch (caught) {
    error.value = apiErrorText(caught, t)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.station-form {
  padding: 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.mask-hint {
  margin: 4px 0 8px;
  line-height: 1.5;
}
.mask-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
