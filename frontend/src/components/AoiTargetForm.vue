<template>
  <div class="form-stack aoi-form" data-testid="aoi-form">
    <v-btn-toggle v-if="!only" v-model="kind" class="segmented" mandatory>
      <v-btn value="point">{{ t('mission.access.kindPoint') }}</v-btn>
      <v-btn value="box">{{ t('mission.access.kindBox') }}</v-btn>
    </v-btn-toggle>
    <v-text-field v-model="name" :label="t('mission.access.name')" :maxlength="MAX_TARGET_NAME" />
    <div v-if="kind === 'point'" class="form-pair">
      <v-text-field v-model.number="point.lat" type="number" :label="t('mission.access.latDeg')" />
      <v-text-field v-model.number="point.lon" type="number" :label="t('mission.access.lonDeg')" />
    </div>
    <div v-else class="form-pair">
      <v-text-field v-model.number="box.west" type="number" :label="t('mission.access.westDeg')" />
      <v-text-field v-model.number="box.east" type="number" :label="t('mission.access.eastDeg')" />
      <v-text-field
        v-model.number="box.south"
        type="number"
        :label="t('mission.access.southDeg')"
      />
      <v-text-field
        v-model.number="box.north"
        type="number"
        :label="t('mission.access.northDeg')"
      />
    </div>
    <div class="actions">
      <v-btn variant="text" @click="emit('close')">{{ t('common.cancel') }}</v-btn>
      <v-btn color="primary" variant="tonal" :disabled="!valid" @click="add">
        {{ t('mission.access.add') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MAX_TARGET_NAME } from '../mission/targets'
import { useMissionStore } from '../stores/mission'

const props = defineProps<{
  /** Take areas only, without the choice between a point and an area. */
  only?: 'box'
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const mission = useMissionStore()
const kind = ref<'point' | 'box'>(props.only ?? 'point')
const name = ref('')
const point = reactive({ lat: 36.35, lon: 127.38 })
const box = reactive({ west: 125, south: 33, east: 130, north: 38.5 })

const isLat = (value: unknown) => typeof value === 'number' && Math.abs(value) <= 90
const isLon = (value: unknown) => typeof value === 'number' && Math.abs(value) <= 180

const valid = computed(() =>
  kind.value === 'point'
    ? isLat(point.lat) && isLon(point.lon)
    : isLon(box.west) &&
      isLon(box.east) &&
      isLat(box.south) &&
      isLat(box.north) &&
      box.south < box.north,
)

function add() {
  if (!valid.value) return
  if (kind.value === 'point') mission.addPoint(point.lat, point.lon, name.value)
  else {
    mission.addBox(
      { west_deg: box.west, south_deg: box.south, east_deg: box.east, north_deg: box.north },
      name.value,
    )
  }
  emit('close')
}
</script>

<style scoped>
.aoi-form {
  padding: 10px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
</style>
