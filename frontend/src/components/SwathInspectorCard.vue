<template>
  <DashboardCard
    v-if="run"
    :title="run.name"
    :eyebrow="`SWATH · NORAD ${run.noradId}`"
    :icon="ScanLine"
  >
    <template #append>
      <v-btn
        icon
        size="small"
        variant="text"
        :aria-label="t('swath.deselect')"
        @click="runs.select(null)"
      >
        <X :size="16" />
      </v-btn>
    </template>
    <div class="form-stack">
      <RunSelect
        :runs="runs.runs"
        :model-value="runs.selectedRunId"
        :label="t('swath.runPicker')"
        :placeholder="t('swath.runPickerEmpty')"
        show-label
        test-id="swath-run-select"
        @update:model-value="runs.select"
      />
      <div class="draw-row">
        <v-switch
          v-model="selection.drawEnabled"
          color="primary"
          data-testid="swath-draw"
          :label="t('swath.draw')"
        />
        <v-tooltip :text="t('swath.drawHint')" location="bottom" max-width="260">
          <template #activator="{ props: tip }">
            <Info
              v-bind="tip"
              :size="15"
              class="muted"
              tabindex="0"
              role="img"
              :aria-label="t('swath.drawHint')"
            />
          </template>
        </v-tooltip>
      </div>
      <v-progress-linear v-if="selection.busy" indeterminate color="primary" height="2" />
      <v-alert v-if="selection.error" type="error" variant="tonal" density="compact">
        {{ selection.error }}
      </v-alert>

      <div v-if="selection.swath" class="stat-grid" data-testid="swath-stats">
        <div class="stat">
          <span>{{ t('swath.nadirWidth') }}</span
          ><strong>{{ selection.swath.nadir_width_km.toFixed(1) }}</strong
          ><small>km</small>
        </div>
        <div class="stat">
          <span>{{ t('swath.forWidth') }}</span>
          <strong>{{ selection.swath.for_width_km?.toFixed(0) ?? '—' }}</strong
          ><small v-if="selection.swath.for_width_km">km</small>
        </div>
        <div class="stat">
          <span>{{ t('swath.fov') }}</span
          ><strong>{{ selection.swath.fov_deg.toFixed(2) }}</strong
          ><small>°</small>
        </div>
        <div class="stat">
          <span>{{ t('swath.daylightFraction') }}</span
          ><strong>{{ (selection.swath.daylight_fraction * 100).toFixed(0) }}</strong
          ><small>%</small>
        </div>
      </div>

      <CollapsibleSection
        id="swath.overlays"
        :title="t('swath.overlays')"
        :summary="overlaySummary"
      >
        <div class="toggles">
          <v-switch v-model="selection.toggles.nadir" :label="t('swath.nadirWidth')" />
          <v-switch v-model="selection.toggles.fieldOfRegard" :label="t('swath.forWidth')" />
          <div class="switch-tip">
            <v-switch v-model="selection.toggles.daylightOnly" :label="t('swath.daylightOnly')" />
            <InfoTip :label="t('swath.nightAbout')" data-testid="swath-night-about">
              {{ t('swath.nightNote') }}
            </InfoTip>
          </div>
          <v-switch v-model="selection.toggles.cone" :label="t('swath.cone')" />
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="swath.sensor" :title="t('swath.sensor')" :summary="presetTitle">
        <div class="preset-head">
          <p class="section-label">{{ t('swath.preset') }}</p>
          <v-tooltip :text="t('swath.presetNote')" location="bottom" max-width="260">
            <template #activator="{ props: tip }">
              <Info
                v-bind="tip"
                :size="13"
                class="muted"
                tabindex="0"
                :aria-label="t('swath.presetNote')"
              />
            </template>
          </v-tooltip>
        </div>
        <SensorPresetPicker
          :model-value="presetChoice"
          :saved="presets.list"
          @update:model-value="choosePreset"
          @delete="deletePreset"
        />
        <v-btn-toggle v-model="draft.mode" class="segmented">
          <v-btn value="swath">{{ t('swath.modeSwath') }}</v-btn>
          <v-btn value="fov">FOV (°)</v-btn>
        </v-btn-toggle>
        <div class="form-pair">
          <v-text-field
            v-if="draft.mode === 'swath'"
            ref="firstField"
            v-model.number="draft.swathKm"
            type="number"
            min="0.1"
            :label="t('swath.nadirWidth')"
            suffix="km"
          />
          <v-text-field
            v-else
            ref="firstField"
            v-model.number="draft.fovDeg"
            type="number"
            min="0.01"
            label="FOV"
            suffix="°"
          />
          <v-text-field
            v-model.number="draft.maxOffNadirDeg"
            type="number"
            min="0"
            max="88"
            :label="t('swath.maxOffNadir')"
            suffix="°"
          />
          <v-text-field
            v-model.number="draft.minSunElevDeg"
            type="number"
            min="-18"
            max="90"
            :label="t('swath.minSunElevation')"
            suffix="°"
          />
          <v-btn
            class="form-action"
            color="primary"
            :disabled="!changed || !valid"
            :loading="selection.busy"
            @click="apply"
          >
            {{ t('common.apply') }}
          </v-btn>
        </div>
        <SensorPresetSave :settings="draft" :valid="valid" @saved="onSaved" />
      </CollapsibleSection>

      <v-alert
        v-for="warning in warnings"
        :key="warning"
        type="warning"
        variant="tonal"
        density="compact"
      >
        {{ warning }}
      </v-alert>
    </div>
  </DashboardCard>
  <DashboardCard v-else :title="t('swath.title')" eyebrow="SWATH" :icon="ScanLine">
    <div v-if="runs.runs.length" class="form-stack">
      <RunSelect
        :runs="runs.runs"
        :model-value="runs.selectedRunId"
        :label="t('swath.runPicker')"
        :placeholder="t('swath.runPickerEmpty')"
        show-label
        test-id="swath-run-select"
        @update:model-value="runs.select"
      />
      <div class="empty-hint">{{ t('swath.pickFromList') }}</div>
    </div>
    <div v-else class="empty-hint">
      {{ t('swath.pickRun') }}
      <br />
      <v-btn
        class="mt-2"
        size="small"
        variant="tonal"
        color="primary"
        @click="ui.openSatelliteStep('runs')"
      >
        {{ t('swath.openRuns') }}
      </v-btn>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import { Info, ScanLine, X } from 'lucide-vue-next'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { warningTexts } from '../api/messages'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import {
  matchingPreset,
  sensorPresets,
  type SensorSettings,
  type UserSensorPreset,
} from '../sensors/presets'
import { useRunsStore } from '../stores/runs'
import { useSelectionStore } from '../stores/selection'
import { useSensorPresetsStore } from '../stores/sensorPresets'
import { useUiStore } from '../stores/ui'
import CollapsibleSection from './CollapsibleSection.vue'
import InfoTip from './InfoTip.vue'
import SensorPresetPicker from './SensorPresetPicker.vue'
import SensorPresetSave from './SensorPresetSave.vue'
import DashboardCard from './DashboardCard.vue'
import RunSelect from './RunSelect.vue'

const { t } = useI18n()
const locale = useLocaleStore()
const runs = useRunsStore()
const ui = useUiStore()
const selection = useSelectionStore()
const run = computed(() => runs.selectedRun)
const presets = useSensorPresetsStore()
void presets.load()
const draft = reactive<SensorSettings>({ ...selection.sensor })

/** The tile in view: a preset while the values match it, or 'custom' once picked or edited. */
const presetChoice = ref(matchingPreset(draft, presets.list) ?? 'custom')
const firstField = ref<{ focus: () => void } | null>(null)

watch(
  () => selection.sensor,
  (sensor) => {
    Object.assign(draft, sensor)
    presetChoice.value = matchingPreset(sensor, presets.list) ?? 'custom'
  },
)
// Editing away from a preset turns the choice to 'custom'; picking 'custom' by hand sticks
// even while the values still equal a preset.
watch(
  () => matchingPreset(draft, presets.list),
  (id) => {
    if (!id) presetChoice.value = 'custom'
    else if (presetChoice.value !== 'custom') presetChoice.value = id
  },
)
/** What a folded section still says about itself. */
const presetTitle = computed(() => {
  const builtIn = sensorPresets.find((item) => item.id === presetChoice.value)
  if (builtIn) return pick(builtIn.label, locale.locale)
  const saved = presets.list.find((item) => item.id === presetChoice.value)
  return saved?.name ?? t('swath.presetCustom')
})
const overlaySummary = computed(() => {
  const toggles = selection.toggles
  const on = [toggles.nadir, toggles.fieldOfRegard, toggles.daylightOnly, toggles.cone]
  return `${on.filter(Boolean).length}/${on.length}`
})
const changed = computed(() => JSON.stringify(draft) !== JSON.stringify(selection.sensor))
const valid = computed(
  () =>
    (draft.mode === 'swath' ? draft.swathKm > 0 : draft.fovDeg > 0 && draft.fovDeg < 179) &&
    draft.maxOffNadirDeg >= 0 &&
    draft.maxOffNadirDeg < 89 &&
    draft.minSunElevDeg >= -18 &&
    draft.minSunElevDeg <= 90,
)
const warnings = computed(() =>
  warningTexts([...(run.value?.data.warnings ?? []), ...(selection.swath?.warnings ?? [])], t),
)

function choosePreset(id: string) {
  presetChoice.value = id
  const preset = [...sensorPresets, ...presets.list].find((item) => item.id === id)
  if (preset) Object.assign(draft, preset.settings)
  else void nextTick(() => firstField.value?.focus())
}

function onSaved(preset: UserSensorPreset) {
  presetChoice.value = preset.id
}

async function deletePreset(id: string) {
  const preset = presets.list.find((item) => item.id === id)
  if (!preset) return
  await presets.remove(preset)
  if (presetChoice.value === id) presetChoice.value = matchingPreset(draft) ?? 'custom'
}

function apply() {
  if (valid.value) void selection.applySensor({ ...draft })
}
</script>

<style scoped>
.draw-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.draw-row :deep(.v-switch) {
  flex: none;
}
.preset-head {
  display: flex;
  align-items: center;
  gap: 5px;
}
.preset-head .section-label {
  margin: 0;
}
.form-stack > .preset-head {
  margin-bottom: calc(var(--space-2) - var(--stack-gap));
}
.toggles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-1) var(--space-3);
}
.switch-tip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.toggles :deep(.v-label) {
  font-size: 12.5px;
}
</style>
