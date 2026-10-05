<template>
  <form class="form-stack import-form" data-testid="imagery-form" @submit.prevent="submit">
    <v-btn-toggle v-model="format" class="segmented" :aria-label="t('imagery.form.format')">
      <v-btn
        v-for="option in IMAGERY_FORMATS"
        :key="option"
        :value="option"
        :title="t(`imagery.form.formatHint.${option}`)"
        :data-testid="`imagery-format-${option}`"
      >
        {{ t(`imagery.format.${option}`) }}
      </v-btn>
    </v-btn-toggle>

    <div class="file-row">
      <v-btn size="small" variant="tonal" @click="fileInput?.click()">
        <Upload :size="14" class="mr-1" aria-hidden="true" />{{ t('imagery.form.file') }}
      </v-btn>
      <small v-if="file" class="file-name">{{ file.name }} · {{ formatBytes(file.size) }}</small>
      <input
        ref="fileInput"
        type="file"
        :accept="ALL_ACCEPT"
        multiple
        hidden
        data-testid="imagery-file"
        @change="onFileChosen"
      />
    </div>

    <v-text-field
      v-model="name"
      :label="t('imagery.form.name')"
      maxlength="60"
      data-testid="imagery-name"
    />
    <v-text-field
      v-model="attribution"
      :label="t('imagery.form.attribution')"
      :hint="t('imagery.form.attributionHint')"
      maxlength="200"
      data-testid="imagery-attribution"
    />
    <v-text-field
      v-model="license"
      :label="t('imagery.form.license')"
      :placeholder="t('imagery.form.licensePlaceholder')"
      maxlength="60"
    />
    <v-text-field v-model="acquired" type="datetime-local" :label="t('imagery.form.acquired')" />
    <ImagerySensorToggle v-model="sensor" />

    <template v-if="format === 'image'">
      <v-textarea
        v-model="cornersText"
        :label="t('imagery.form.corners')"
        :error-messages="cornersText && !corners ? t('imagery.form.cornersInvalid') : ''"
        rows="3"
        variant="outlined"
        density="compact"
        hide-details="auto"
        data-testid="imagery-corners"
      />
      <p class="field-note">{{ t('imagery.form.cornersHint') }}</p>
    </template>

    <p v-if="error" class="text-error text-caption message" data-testid="imagery-form-error">
      {{ error }}
    </p>
    <div class="actions">
      <v-btn variant="text" size="small" :disabled="busy" @click="emit('close')">
        {{ t('imagery.form.close') }}
      </v-btn>
      <v-btn
        type="submit"
        color="primary"
        variant="tonal"
        size="small"
        :loading="busy"
        :disabled="!valid"
        data-testid="imagery-submit"
      >
        {{ t('imagery.form.submit') }}
      </v-btn>
    </div>
  </form>
</template>

<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImagerySensor, ImagerySourceFormat } from '../api/types'
import { useImageryStore } from '../stores/imagery'
import {
  IMAGERY_FORMATS,
  guessImageryFormat,
  imageryAccept,
  imageryFileProblem,
  nameFromFile,
  parseCorners,
} from '../utils/imagery'
import { formatBytes } from '../utils/namedFiles'
import { fromUtcInput } from '../utils/time'
import ImagerySensorToggle from './ImagerySensorToggle.vue'

const props = defineProps<{ initialFile?: File }>()
const emit = defineEmits<{ close: []; batch: [files: File[]] }>()

const { t } = useI18n()
const imagery = useImageryStore()

const format = ref<ImagerySourceFormat>('mbtiles')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const name = ref('')
const attribution = ref('')
const license = ref('')
const sensor = ref<ImagerySensor | ''>('')
/** `datetime-local` text, read as UTC. */
const acquired = ref('')
const cornersText = ref('')
const busy = ref(false)
const error = ref('')

const corners = computed(() => parseCorners(cornersText.value))
const acquiredMs = computed(() => (acquired.value ? fromUtcInput(acquired.value) : null))
const valid = computed(
  () =>
    Boolean(file.value) &&
    Boolean(name.value.trim()) &&
    (format.value !== 'image' || corners.value !== null) &&
    !Number.isNaN(acquiredMs.value),
)

// A file picked for one format is not one for another.
watch(format, () => {
  if (file.value && guessImageryFormat(file.value.name) !== format.value) file.value = null
})

/** Every extension SODA takes: the picker offers them all and the file decides the format. */
const ALL_ACCEPT = IMAGERY_FORMATS.map(imageryAccept).join(',')

function take(chosen: File) {
  const guessed = guessImageryFormat(chosen.name)
  if (guessed) format.value = guessed
  file.value = chosen
  error.value = guessed ? imageryFileProblem(guessed, chosen) : ''
  if (!name.value.trim()) name.value = nameFromFile(chosen.name)
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = [...(input.files ?? [])]
  input.value = ''
  if (chosen.length > 1) emit('batch', chosen)
  else if (chosen[0]) take(chosen[0])
}

if (props.initialFile) take(props.initialFile)

async function submit() {
  if (!valid.value || !file.value) return
  busy.value = true
  error.value = ''
  try {
    await imagery.upload(
      {
        source_format: format.value,
        name: name.value.trim(),
        attribution: attribution.value.trim(),
        license: license.value.trim(),
        acquired_at: acquiredMs.value === null ? '' : new Date(acquiredMs.value).toISOString(),
        corners_deg: format.value === 'image' ? corners.value : null,
        sensor: sensor.value || null,
      },
      file.value,
    )
    emit('close')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.file-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.file-name {
  overflow: hidden;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.message {
  margin: 0;
}
</style>
