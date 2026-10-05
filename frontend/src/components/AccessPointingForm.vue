<template>
  <div class="form-stack pointing" data-testid="access-pointing">
    <v-btn-toggle
      v-model="settings.pointingMode"
      class="segmented"
      mandatory
      :aria-label="t('mission.access.pointing.label')"
    >
      <v-btn value="roll" data-testid="pointing-roll">{{
        t('mission.access.pointing.roll')
      }}</v-btn>
      <v-btn value="roll_pitch" data-testid="pointing-roll-pitch">
        {{ t('mission.access.pointing.rollPitch') }}
      </v-btn>
    </v-btn-toggle>
    <p class="muted text-caption explain" data-testid="pointing-explain">
      {{ t(`mission.access.pointing.explain.${settings.pointingMode}`) }}
    </p>
    <div class="form-pair">
      <v-text-field
        v-model.number="settings.maxRollDeg"
        type="number"
        min="1"
        max="88"
        :label="t('mission.access.maxRoll')"
      />
      <v-text-field
        v-if="settings.pointingMode === 'roll_pitch'"
        v-model.number="settings.maxPitchDeg"
        type="number"
        min="0"
        max="88"
        :label="t('mission.access.maxPitch')"
      />
      <v-text-field
        v-model.number="settings.fovDeg"
        type="number"
        min="0"
        max="178"
        :label="t('mission.access.fov')"
        :title="t('mission.access.fovHint')"
        data-testid="access-fov"
      />
      <v-text-field
        v-model.number="settings.minSunElevDeg"
        type="number"
        min="-90"
        max="90"
        :label="t('mission.access.minSunElev')"
      />
    </div>
    <v-btn
      size="small"
      variant="text"
      class="import"
      data-testid="access-import-sensor"
      @click="importSensor"
    >
      <ScanLine :size="14" class="mr-1" aria-hidden="true" />{{ t('mission.access.importSensor') }}
    </v-btn>
    <p v-if="swathSensor && differs" class="field-note" data-testid="access-sensor-differs">
      {{
        t('mission.access.sensorDiffers', {
          roll: swathSensor.maxRollDeg,
          fov: swathSensor.fovDeg,
          sun: swathSensor.minSunElevDeg,
        })
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ScanLine } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { pointingDiffers, pointingFromSensor, type SensorPointing } from '../mission/sensorImport'
import { useMissionStore } from '../stores/mission'
import { useRunsStore } from '../stores/runs'
import { useSelectionStore } from '../stores/selection'

const props = defineProps<{ runId: string | null }>()

/**
 * How far the sensor can point. The explanation under the toggle is the model the
 * backend uses, spelled out so a result can be read against it.
 */
const { t } = useI18n()
const settings = useMissionStore().saved
const selection = useSelectionStore()
const runs = useRunsStore()

/** What the swath tool's sensor would set here. */
function sensorPointing(drawn: boolean): SensorPointing {
  const run = runs.runs.find((item) => item.id === props.runId)
  const alt = run?.data.alt_km.length
    ? run.data.alt_km.reduce((sum, value) => sum + value, 0) / run.data.alt_km.length
    : 500
  const sensor = drawn ? selection.appliedSensor! : selection.sensor
  const swathFov = drawn ? (selection.swath?.fov_deg ?? null) : null
  return { ...pointingFromSensor(sensor, swathFov, alt), minSunElevDeg: sensor.minSunElevDeg }
}

/** The sensor of the swath on the globe; with none drawn there is nothing to disagree with. */
const swathSensor = computed(() => (selection.appliedSensor ? sensorPointing(true) : null))
const differs = computed(() => !!swathSensor.value && pointingDiffers(swathSensor.value, settings))

/** Same sensor as the swath tool, so the search matches the field of regard it draws. */
function importSensor() {
  Object.assign(settings, sensorPointing(!!selection.appliedSensor))
}
</script>

<style scoped>
.explain {
  margin: calc(var(--space-1) - var(--stack-gap)) 0 0;
}
.import {
  justify-self: start;
}
</style>
