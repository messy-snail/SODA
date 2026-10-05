<template>
  <div class="form-stack" data-testid="power-settings">
    <div class="label-row">
      <p class="section-label">{{ t('missionPower.attitude.label') }}</p>
      <InfoTip :label="t('missionPower.attitude.label')">
        <ul class="tip-list">
          <li v-for="attitude in CONTACT_ATTITUDES" :key="attitude">
            <strong>{{ t(`missionPower.attitude.${attitude}`) }}</strong>
            {{ t(`missionPower.attitude.explain.${attitude}`) }}
          </li>
        </ul>
      </InfoTip>
    </div>
    <v-btn-toggle
      v-model="settings.contactAttitude"
      class="segmented attitude-picker"
      mandatory
      :aria-label="t('missionPower.attitude.label')"
      data-testid="power-attitude"
    >
      <v-btn v-for="attitude in CONTACT_ATTITUDES" :key="attitude" :value="attitude">
        <span class="attitude-option">
          <component :is="ATTITUDE_ICONS[attitude]" :size="20" aria-hidden="true" />
          {{ t(`missionPower.attitude.${attitude}`) }}
        </span>
      </v-btn>
    </v-btn-toggle>

    <div class="label-row">
      <p class="section-label">{{ t('missionPower.groups.battery') }}</p>
      <InfoTip :label="t('missionPower.battery.kind.label')">
        <ul class="tip-list">
          <li v-for="kind in BATTERY_KINDS" :key="kind">
            <strong>{{ t(`missionPower.battery.kind.${kind}`) }}</strong>
            {{ t(`missionPower.battery.kind.explain.${kind}`) }}
          </li>
        </ul>
      </InfoTip>
    </div>
    <v-btn-toggle
      v-model="settings.batteryKind"
      class="segmented"
      mandatory
      :aria-label="t('missionPower.battery.kind.label')"
      data-testid="power-battery-kind"
    >
      <v-btn v-for="kind in BATTERY_KINDS" :key="kind" :value="kind">
        {{ t(`missionPower.battery.kind.${kind}`) }}
      </v-btn>
    </v-btn-toggle>
    <div class="form-triple">
      <v-text-field
        v-for="field in powerFields"
        :key="field"
        v-model.number="settings[field]"
        type="number"
        :min="POWER_LIMITS[field][0]"
        :max="POWER_LIMITS[field][1]"
        :label="t(`missionPower.fields.${field}`)"
      />
      <template v-if="settings.batteryKind === 'circuit'">
        <v-text-field
          v-for="field in BATTERY_FIELDS"
          :key="field"
          v-model.number="settings.battery[field]"
          type="number"
          step="any"
          :min="BATTERY_LIMITS[field][0]"
          :max="BATTERY_LIMITS[field][1]"
          :label="t(`missionPower.battery.fields.${field}`)"
        />
        <v-btn
          class="form-action curve-button"
          variant="tonal"
          data-testid="power-curve-open"
          @click="curveOpen = true"
        >
          <Spline :size="15" class="mr-1" aria-hidden="true" />{{ t('missionPower.curve.edit') }}
        </v-btn>
      </template>
    </div>

    <p class="section-label">{{ t('missionPower.groups.loads') }}</p>
    <div class="form-triple">
      <v-text-field
        v-for="field in LOAD_FIELDS"
        :key="field"
        v-model.number="settings[field]"
        type="number"
        :min="POWER_LIMITS[field][0]"
        :max="POWER_LIMITS[field][1]"
        :label="t(`missionPower.fields.${field}`)"
      />
    </div>
    <p v-if="!powerSettingsValid(settings)" class="field-note" data-testid="power-invalid">
      {{ t('missionPower.invalid') }}
    </p>
    <OcvCurveDialog
      v-model="curveOpen"
      :points="settings.battery.ocv"
      @apply="(points) => (settings.battery.ocv = points)"
    />
  </div>
</template>

<script setup lang="ts">
import { Spline } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BATTERY_FIELDS, BATTERY_LIMITS } from '../mission/battery'
import {
  BATTERY_KINDS,
  CONTACT_ATTITUDES,
  POWER_LIMITS,
  powerSettingsValid,
  type PowerField,
} from '../mission/power'
import { useMissionStore } from '../stores/mission'
import InfoTip from './InfoTip.vue'
import OcvCurveDialog from './OcvCurveDialog.vue'
import { ATTITUDE_ICONS } from './powerAttitudeIcons'

const LOAD_FIELDS: PowerField[] = ['baseW', 'imagingW', 'downlinkW', 'contactW', 'slewS']

/**
 * Attitude, array, battery and loads of the power tool; the starting state sits with the
 * chart. The contact attitude comes first: it decides how the rest of the budget is read.
 */
const { t } = useI18n()
const settings = useMissionStore().saved.power
const curveOpen = ref(false)

/** The energy model has a capacity in watt-hours; the circuit brings its own in amp-hours. */
const powerFields = computed<PowerField[]>(() =>
  settings.batteryKind === 'circuit'
    ? ['arrayW', 'dodLimitPct', 'chargeEffPct', 'dischargeEffPct']
    : ['arrayW', 'capacityWh', 'dodLimitPct', 'chargeEffPct', 'dischargeEffPct'],
)
</script>

<style scoped>
.label-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.label-row .section-label {
  margin: 0;
}
.form-stack > .label-row {
  margin-bottom: calc(var(--space-3) - var(--stack-gap));
}
/* Three short fields to a row keep the settings on one screen. */
.form-triple {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4) var(--space-2);
}
.curve-button {
  grid-column: span 2;
}
/* Icon over label, so the three attitudes read as pictures first. */
.attitude-picker.v-btn-group {
  height: 60px;
}
.attitude-option {
  display: grid;
  justify-items: center;
  gap: var(--space-1);
  line-height: 1.2;
}
</style>
