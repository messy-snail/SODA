<template>
  <div class="preset-save">
    <v-btn
      v-if="!open"
      variant="text"
      size="small"
      class="preset-save__open"
      :disabled="!valid"
      data-testid="sensor-preset-save-open"
      @click="start"
    >
      <BookmarkPlus :size="14" class="mr-1" aria-hidden="true" />{{ t('swath.savePreset') }}
    </v-btn>
    <form v-else class="preset-save__form" @submit.prevent="save">
      <v-text-field
        ref="nameField"
        v-model="name"
        :label="t('swath.presetName')"
        maxlength="40"
        data-testid="sensor-preset-name"
        @keydown.esc="cancel"
      />
      <p v-if="clash" class="preset-save__note" role="status">{{ t('swath.presetNameTaken') }}</p>
      <p v-else-if="failure" class="preset-save__note text-error" role="alert">{{ failure }}</p>
      <div class="preset-save__actions">
        <v-btn variant="text" size="small" @click="cancel">{{ t('common.cancel') }}</v-btn>
        <v-btn
          v-if="clash"
          color="warning"
          variant="tonal"
          size="small"
          :loading="busy"
          data-testid="sensor-preset-overwrite"
          @click="overwrite"
        >
          {{ t('swath.overwrite') }}
        </v-btn>
        <v-btn
          v-else
          type="submit"
          color="primary"
          variant="tonal"
          size="small"
          :disabled="!name.trim()"
          :loading="busy"
          data-testid="sensor-preset-save"
        >
          {{ t('common.save') }}
        </v-btn>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { BookmarkPlus } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '../api/client'
import { apiErrorText } from '../api/messages'
import type { SensorSettings, UserSensorPreset } from '../sensors/presets'
import { useSensorPresetsStore } from '../stores/sensorPresets'

const props = defineProps<{ settings: SensorSettings; valid: boolean }>()
const emit = defineEmits<{ saved: [preset: UserSensorPreset] }>()
const { t } = useI18n()
const presets = useSensorPresetsStore()

const open = ref(false)
const name = ref('')
const busy = ref(false)
/** Set when the name belongs to a saved preset, so the next press overwrites it. */
const clash = ref(false)
const failure = ref('')
const nameField = ref<{ focus: () => void } | null>(null)

// A different name is a different request: drop the overwrite offer.
watch(name, () => {
  clash.value = false
  failure.value = ''
})

function start() {
  open.value = true
  void nextTick(() => nameField.value?.focus())
}

function cancel() {
  open.value = false
  name.value = ''
}

async function run(action: () => Promise<UserSensorPreset>) {
  busy.value = true
  try {
    emit('saved', await action())
    cancel()
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'sensorPresetNameTaken') clash.value = true
    else failure.value = apiErrorText(caught, t)
  } finally {
    busy.value = false
  }
}

function save() {
  if (!name.value.trim() || busy.value) return
  void run(() => presets.save(name.value.trim(), { ...props.settings }))
}

function overwrite() {
  const target = presets.list.find((preset) => preset.name === name.value.trim())
  if (!target) {
    clash.value = false
    return save()
  }
  void run(() => presets.overwrite(target, { ...props.settings }))
}
</script>

<style scoped>
.preset-save__open {
  justify-self: start;
  margin-left: -8px;
}
.preset-save__form {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.preset-save__note {
  margin: 0;
  font-size: 11.5px;
  color: rgb(var(--v-theme-warning));
}
.preset-save__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
}
.preset-save {
  display: grid;
}
</style>
