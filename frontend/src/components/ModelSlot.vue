<template>
  <div class="model-slot">
    <div class="slot-head">
      <span class="slot-icon" :class="{ empty: !model }"
        ><Box :size="16" aria-hidden="true"
      /></span>
      <span class="grow">
        <strong>{{ label }}</strong>
        <small v-if="model">
          {{ formatBytes(model.size_bytes) }} · {{ formatUtc(Date.parse(model.updated_at), false) }}
          UTC
        </small>
        <small v-else>{{ emptyText }}</small>
      </span>
      <v-btn size="small" variant="tonal" color="primary" :loading="busy" @click="pickFile">
        <Upload :size="14" class="mr-1" aria-hidden="true" />{{
          model ? t('models.slot.replace') : t('models.slot.upload')
        }}
      </v-btn>
      <template v-if="model">
        <v-btn
          icon
          size="x-small"
          variant="text"
          :color="showSettings ? 'primary' : undefined"
          :aria-label="
            showSettings ? t('models.slot.closeSettings') : t('models.slot.openSettings')
          "
          :aria-expanded="showSettings"
          @click="showSettings = !showSettings"
        >
          <SlidersHorizontal :size="15" />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="text"
          :aria-label="t('models.slot.remove')"
          :disabled="busy"
          @click="removeModel"
        >
          <Trash2 :size="15" />
        </v-btn>
      </template>
      <input ref="fileInput" type="file" accept=".glb" hidden @change="onFileChosen" />
    </div>

    <p v-if="error" class="text-error text-caption message">{{ error }}</p>

    <v-expand-transition>
      <div v-if="model && showSettings" class="settings">
        <div class="form-pair">
          <v-text-field
            v-model.number="draft.minimum_size_px"
            type="number"
            :label="t('models.slot.minimumSize')"
            min="0"
            max="512"
            step="4"
          />
          <v-text-field
            v-model.number="draft.scale"
            type="number"
            :label="t('models.slot.scale')"
            min="0.01"
            max="1000"
            step="0.1"
          />
        </div>
        <div class="angles">
          <v-text-field
            v-for="axis in axes"
            :key="axis.key"
            v-model.number="draft[axis.key]"
            type="number"
            :label="axis.label"
            min="-180"
            max="180"
            step="15"
          />
        </div>
        <div class="actions">
          <v-btn size="small" variant="text" :disabled="!dirty || busy" @click="resetDraft">
            {{ t('models.slot.revert') }}
          </v-btn>
          <v-btn
            size="small"
            color="primary"
            :disabled="!dirty || !valid"
            :loading="busy"
            @click="saveSettings"
          >
            {{ t('models.slot.saveSettings') }}
          </v-btn>
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
import { Box, SlidersHorizontal, Trash2, Upload } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import type { ModelSettings } from '../api/types'
import { useI18n } from 'vue-i18n'
import { useModelsStore } from '../stores/models'
import { formatBytes } from '../utils/models'
import { formatUtc } from '../utils/time'

const props = defineProps<{ name: string; label: string; emptyText?: string }>()

type AngleKey = 'heading_deg' | 'pitch_deg' | 'roll_deg'
const axes: { key: AngleKey; label: string }[] = [
  { key: 'heading_deg', label: 'Heading (°)' },
  { key: 'pitch_deg', label: 'Pitch (°)' },
  { key: 'roll_deg', label: 'Roll (°)' },
]

const { t } = useI18n()
const models = useModelsStore()
const model = computed(() => models.find(props.name))
const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref('')
const showSettings = ref(false)
const draft = reactive<ModelSettings>({
  heading_deg: 0,
  pitch_deg: 0,
  roll_deg: 0,
  scale: 1,
  minimum_size_px: 48,
})

const dirty = computed(() => {
  const saved = model.value?.settings
  return (
    Boolean(saved) &&
    (Object.keys(draft) as (keyof ModelSettings)[]).some((key) => draft[key] !== saved![key])
  )
})
const valid = computed(() => {
  const within = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  return (
    within(draft.minimum_size_px, 0, 512) &&
    within(draft.scale, 0, 1000) &&
    draft.scale > 0 &&
    axes.every((axis) => within(draft[axis.key], -180, 180))
  )
})

function resetDraft() {
  if (model.value) Object.assign(draft, model.value.settings)
}
watch(() => model.value?.settings, resetDraft, { immediate: true })

async function run(task: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await task()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}

function pickFile() {
  fileInput.value?.click()
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void run(() => models.upload(props.name, file))
}

function saveSettings() {
  void run(() => models.saveSettings(props.name, { ...draft }))
}

function removeModel() {
  if (!confirm(t('models.slot.confirmDelete', { label: props.label }))) return
  showSettings.value = false
  void run(() => models.remove(props.name))
}
</script>

<style scoped>
.model-slot {
  display: grid;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.slot-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slot-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.slot-icon.empty {
  color: rgb(var(--v-theme-secondary));
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.grow {
  flex: 1;
  min-width: 0;
}
.grow strong {
  display: block;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow small {
  display: block;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
}
.message {
  margin: 0;
}
.settings {
  display: grid;
  gap: 10px;
  padding-top: 4px;
}
.angles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
