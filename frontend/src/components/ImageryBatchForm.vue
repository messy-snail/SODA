<template>
  <form class="form-stack batch-form" data-testid="imagery-batch" @submit.prevent="submit">
    <p class="section-label">{{ t('imagery.batch.title', { count: entries.length }) }}</p>
    <ul class="files">
      <li v-for="(entry, index) in entries" :key="index" :class="{ out: !!entry.problem }">
        <span class="file-name">{{ entry.file.name }}</span>
        <small v-if="entry.problem" class="text-warning">{{ entry.problem }}</small>
        <small v-else-if="errors[index]" class="text-error">{{ errors[index] }}</small>
        <small v-else :data-testid="`imagery-batch-state-${index}`">
          {{ t(`imagery.format.${entry.format}`) }} · {{ formatBytes(entry.file.size) }} ·
          {{ t(`imagery.batch.${states[index]}`) }}
        </small>
      </li>
    </ul>
    <p v-if="skipped" class="field-note">
      {{ t('imagery.batch.skipped', { usable: usable, skipped }) }}
    </p>
    <v-text-field v-model="attribution" :label="t('imagery.form.attribution')" maxlength="200" />
    <v-text-field
      v-model="license"
      :label="t('imagery.form.license')"
      :placeholder="t('imagery.form.licensePlaceholder')"
      maxlength="60"
    />
    <ImagerySensorToggle v-model="sensor" />
    <p class="field-note">{{ t('imagery.batch.hint') }}</p>
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
        :disabled="!usable || finished"
        data-testid="imagery-batch-submit"
      >
        {{ t('imagery.batch.submit', { count: usable }) }}
      </v-btn>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImagerySensor } from '../api/types'
import { useImageryStore } from '../stores/imagery'
import { planBatch } from '../utils/imagery'
import { formatBytes } from '../utils/namedFiles'
import ImagerySensorToggle from './ImagerySensorToggle.vue'

/** Several files picked or dropped at once: one line each, one attribution for all. */
const props = defineProps<{ files: File[] }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const imagery = useImageryStore()

const entries = computed(() => planBatch(props.files))
const usable = computed(() => entries.value.filter((entry) => !entry.problem).length)
const skipped = computed(() => entries.value.length - usable.value)
const attribution = ref('')
const license = ref('')
const sensor = ref<ImagerySensor | ''>('')
const busy = ref(false)
const finished = ref(false)
const states = ref<('waiting' | 'uploading' | 'done')[]>(props.files.map(() => 'waiting'))
const errors = ref<string[]>(props.files.map(() => ''))

async function submit() {
  if (!usable.value || busy.value) return
  busy.value = true
  const first = entries.value.findIndex((entry) => !entry.problem)
  if (first >= 0) states.value[first] = 'uploading'
  await imagery.uploadMany(
    entries.value,
    {
      attribution: attribution.value.trim(),
      license: license.value.trim(),
      sensor: sensor.value || null,
    },
    (index, error) => {
      errors.value[index] = error
      states.value[index] = 'done'
      const next = entries.value.findIndex((entry, at) => at > index && !entry.problem)
      if (next >= 0) states.value[next] = 'uploading'
    },
  )
  busy.value = false
  finished.value = true
  // A clean batch needs no second look; a failed line stays up to be read.
  if (errors.value.every((error) => !error) && !skipped.value) emit('close')
}
</script>

<style scoped>
.files {
  display: grid;
  gap: var(--space-2);
  max-height: 220px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.files li {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.files li.out .file-name {
  color: rgb(var(--v-theme-secondary));
}
.file-name {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files small {
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
