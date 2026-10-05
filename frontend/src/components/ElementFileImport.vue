<template>
  <div
    class="file-import"
    :class="{ 'file-import--over': dragging }"
    data-testid="element-file-import"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="drop"
  >
    <p class="section-label">{{ t('catalog.custom.file') }}</p>
    <p class="muted text-caption">{{ t('catalog.custom.fileHint') }}</p>
    <v-btn variant="outlined" :loading="busy" data-testid="element-file-pick" @click="pick">
      <Upload :size="15" aria-hidden="true" class="mr-2" />
      {{ t('catalog.custom.filePick') }}
    </v-btn>
    <input
      ref="picker"
      type="file"
      accept=".tle,.3le,.txt,.json,.xml,.kvn,.omm,.csv,text/plain,application/json,text/xml,text/csv"
      hidden
      data-testid="element-file-input"
      @change="chosen"
    />
    <v-alert
      v-if="result"
      :type="result.created.length ? 'success' : 'warning'"
      variant="tonal"
      density="compact"
      data-testid="element-file-result"
    >
      <p>
        {{ t('catalog.custom.imported', { count: result.created.length, total: result.total }) }}
      </p>
      <p v-for="item in shownSkipped" :key="item.index" class="muted">
        {{
          t(`catalog.custom.skipped.${item.reason}`, { name: item.name || `#${item.index + 1}` })
        }}
      </p>
      <p v-if="result.skipped.length > shownSkipped.length" class="muted">
        {{
          t('catalog.custom.skippedMore', { count: result.skipped.length - shownSkipped.length })
        }}
      </p>
    </v-alert>
    <p v-if="failure" class="text-error text-caption" role="alert">{{ failure }}</p>
  </div>
</template>

<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { ElementImportResult } from '../api/types'
import { useCustomElementsStore } from '../stores/customElements'

/** Mirrors `MAX_ELEMENT_FILE_BYTES` in `src/soda/gp/element_files.py`. */
const MAX_ELEMENT_FILE_BYTES = 2 * 1024 * 1024
/** Skipped records listed one by one before the rest collapses into a count. */
const MAX_SKIPPED_SHOWN = 5

const emit = defineEmits<{ imported: [result: ElementImportResult] }>()

const { t } = useI18n()
const store = useCustomElementsStore()
const picker = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const dragging = ref(false)
const failure = ref('')
const result = ref<ElementImportResult | null>(null)

const shownSkipped = computed(() => result.value?.skipped.slice(0, MAX_SKIPPED_SHOWN) ?? [])

function pick() {
  picker.value?.click()
}

function chosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void upload(file)
}

function drop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void upload(file)
}

async function upload(file: File) {
  if (busy.value) return
  failure.value = ''
  result.value = null
  if (file.size > MAX_ELEMENT_FILE_BYTES) {
    failure.value = t('errors.elementFileTooLarge', {
      max_mb: MAX_ELEMENT_FILE_BYTES / (1024 * 1024),
    })
    return
  }
  busy.value = true
  try {
    result.value = await store.importFile(file)
    emit('imported', result.value)
  } catch (caught) {
    failure.value = apiErrorText(caught, t)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.file-import {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 10px;
}
.file-import--over {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.file-import p {
  margin: 0;
}
.file-import > .v-btn {
  justify-self: start;
}
</style>
