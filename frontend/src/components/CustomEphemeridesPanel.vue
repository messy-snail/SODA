<template>
  <div
    class="form-stack"
    data-testid="custom-ephemerides-panel"
    @dragover.prevent
    @drop.prevent="dropped"
  >
    <p class="muted text-caption note">{{ t('catalog.ephemeris.intro') }}</p>
    <div v-if="store.list.length" class="results" data-testid="custom-ephemerides">
      <SatelliteRow
        v-for="item in store.list"
        :key="item.id"
        :sat-ref="{ noradId: 0, customId: item.id, kind: 'ephemeris' }"
        :name="item.name"
        :detail="rowDetail(item)"
      >
        <template #append>
          <v-btn
            icon
            size="x-small"
            variant="text"
            class="delete"
            :aria-label="t('catalog.custom.delete', { name: item.name })"
            :data-testid="`ephemeris-delete-${item.id}`"
            @click.stop="remove(item.id)"
          >
            <Trash2 :size="14" />
          </v-btn>
        </template>
      </SatelliteRow>
    </div>
    <p v-else class="empty-hint">{{ t('catalog.ephemeris.empty') }}</p>

    <div class="add-form">
      <v-text-field
        v-model="name"
        :label="t('catalog.ephemeris.name')"
        maxlength="60"
        data-testid="ephemeris-name"
      />
      <v-btn variant="outlined" :loading="busy" data-testid="ephemeris-file-pick" @click="pick">
        <Upload :size="15" aria-hidden="true" class="mr-2" />
        {{ t('catalog.ephemeris.import') }}
      </v-btn>
      <input
        ref="picker"
        type="file"
        accept=".oem,.txt,.xml,.kvn,text/plain,text/xml"
        hidden
        data-testid="ephemeris-file-input"
        @change="chosen"
      />
      <p v-if="failure" class="text-error text-caption" role="alert">{{ failure }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Trash2, Upload } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { CustomEphemerisSummary } from '../api/types'
import { useCustomEphemeridesStore } from '../stores/customEphemerides'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useSatellitePicksStore } from '../stores/satellitePicks'
import type { SatelliteRef } from '../utils/satelliteRef'
import { formatUtc } from '../utils/time'
import SatelliteRow from './SatelliteRow.vue'

/** Mirrors `MAX_OEM_BYTES` in `src/soda/orbit/oem.py`. */
const MAX_OEM_BYTES = 32 * 1024 * 1024

const { t } = useI18n()
const basket = useSatelliteBasketStore()
const store = useCustomEphemeridesStore()
const picks = useSatellitePicksStore()
const picker = ref<HTMLInputElement | null>(null)
const name = ref('')
const busy = ref(false)
const failure = ref('')

onMounted(() => void store.load())

function refOf(id: number): SatelliteRef {
  return { noradId: 0, customId: id, kind: 'ephemeris' }
}

function rowDetail(item: CustomEphemerisSummary): string {
  const span = `${formatUtc(Date.parse(item.start), false)} – ${formatUtc(Date.parse(item.stop), false)} UTC`
  const samples = t('catalog.ephemeris.samples', { count: item.sample_count.toLocaleString() })
  return `${item.frame} · ${samples} · ${span}`
}

function pick() {
  picker.value?.click()
}

function chosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void upload(file)
}

function dropped(event: DragEvent) {
  const file = event.dataTransfer?.files[0]
  if (file) void upload(file)
}

async function upload(file: File) {
  if (busy.value) return
  failure.value = ''
  if (file.size > MAX_OEM_BYTES) {
    failure.value = t('errors.oemTooLarge', { max_mb: MAX_OEM_BYTES / (1024 * 1024) })
    return
  }
  busy.value = true
  try {
    const created = await store.importFile(file, name.value)
    name.value = ''
    if (created.ephemeris_id != null) basket.add(refOf(created.ephemeris_id), created.name)
  } catch (caught) {
    failure.value = apiErrorText(caught, t)
  } finally {
    busy.value = false
  }
}

async function remove(id: number) {
  await store.remove(id)
  picks.forget(refOf(id))
  basket.remove(refOf(id))
}
</script>

<style scoped>
.results {
  display: grid;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}
.note {
  margin: 0;
}
.add-form {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.add-form > .v-btn {
  justify-self: start;
}
.add-form p {
  margin: 0;
}
.delete {
  flex-shrink: 0;
  margin: -4px -4px -4px 0;
}
</style>
