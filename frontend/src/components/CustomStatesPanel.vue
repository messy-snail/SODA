<template>
  <div class="form-stack" data-testid="custom-states-panel">
    <p class="muted text-caption note">{{ t('catalog.state.intro') }}</p>
    <div v-if="store.list.length" class="results" data-testid="custom-states">
      <SatelliteRow
        v-for="item in store.list"
        :key="item.id"
        :sat-ref="{ noradId: 0, customId: item.id, kind: 'state' }"
        :name="item.name"
        :detail="`${item.frame} · ${item.input_format.toUpperCase()} · ${epochLabel(item.epoch)}`"
        :category="item.category"
      >
        <template #append>
          <v-btn
            icon
            size="x-small"
            variant="text"
            class="delete"
            :aria-label="t('catalog.custom.delete', { name: item.name })"
            :data-testid="`state-delete-${item.id}`"
            @click.stop="remove(item.id)"
          >
            <Trash2 :size="14" />
          </v-btn>
        </template>
      </SatelliteRow>
    </div>
    <p v-else class="empty-hint">{{ t('catalog.state.empty') }}</p>

    <div class="file-row">
      <v-btn variant="outlined" :loading="importing" data-testid="state-file-pick" @click="pick">
        <Upload :size="15" aria-hidden="true" class="mr-2" />
        {{ t('catalog.state.importOpm') }}
      </v-btn>
      <input
        ref="picker"
        type="file"
        accept=".opm,.txt,.xml,.kvn,text/plain,text/xml"
        hidden
        data-testid="state-file-input"
        @change="chosen"
      />
    </div>

    <form class="add-form" @submit.prevent="add">
      <p class="section-label">{{ t('catalog.state.add') }}</p>
      <v-text-field
        v-model="form.name"
        :label="t('catalog.custom.name')"
        maxlength="60"
        data-testid="state-name"
      />
      <v-text-field
        v-model="form.epoch"
        type="datetime-local"
        step="1"
        :label="t('catalog.state.epoch')"
        data-testid="state-epoch"
      />
      <div>
        <p class="section-label">{{ t('catalog.state.frame') }}</p>
        <v-btn-toggle
          v-model="form.frame"
          class="segmented"
          :aria-label="t('catalog.state.frame')"
          data-testid="state-frame"
        >
          <v-btn v-for="frame in STATE_FRAMES" :key="frame" :value="frame">{{ frame }}</v-btn>
        </v-btn-toggle>
      </div>
      <div>
        <p class="section-label">{{ t('catalog.state.position') }}</p>
        <div class="triple">
          <v-text-field
            v-for="(axis, index) in AXES"
            :key="`r${axis}`"
            v-model="form.position[index]"
            inputmode="decimal"
            :label="axis"
            :data-testid="`state-position-${index}`"
          />
        </div>
      </div>
      <div>
        <p class="section-label">{{ t('catalog.state.velocity') }}</p>
        <div class="triple">
          <v-text-field
            v-for="(axis, index) in AXES"
            :key="`v${axis}`"
            v-model="form.velocity[index]"
            inputmode="decimal"
            :label="axis"
            :data-testid="`state-velocity-${index}`"
          />
        </div>
      </div>
      <div class="pair">
        <v-text-field
          v-model="form.massKg"
          type="number"
          min="0"
          step="any"
          :label="t('propagate.hpop.mass')"
          data-testid="state-mass"
        />
        <v-text-field
          v-model="form.areaM2"
          type="number"
          min="0"
          step="any"
          :label="t('propagate.hpop.area')"
        />
        <v-text-field
          v-model="form.cd"
          type="number"
          min="0"
          step="any"
          :label="t('propagate.hpop.cd')"
        />
        <v-text-field
          v-model="form.cr"
          type="number"
          min="0"
          step="any"
          :label="t('propagate.hpop.cr')"
        />
      </div>
      <p class="muted text-caption note">{{ t('catalog.state.craftHint') }}</p>
      <p v-if="failure" class="text-error text-caption" role="alert">{{ failure }}</p>
      <v-btn
        type="submit"
        color="primary"
        variant="tonal"
        :disabled="!request"
        :loading="busy"
        data-testid="state-save"
      >
        <Plus :size="15" class="mr-1" aria-hidden="true" />{{ t('common.save') }}
      </v-btn>
    </form>
  </div>
</template>

<script setup lang="ts">
import { Plus, Trash2, Upload } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { CatalogDetail } from '../api/types'
import { STATE_FRAMES, emptyStateForm, stateRequest } from '../orbit/stateVector'
import { useClockStore } from '../stores/clock'
import { useCustomStatesStore } from '../stores/customStates'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useSatellitePicksStore } from '../stores/satellitePicks'
import type { SatelliteRef } from '../utils/satelliteRef'
import { formatUtc, toUtcInput } from '../utils/time'
import SatelliteRow from './SatelliteRow.vue'

const AXES = ['X', 'Y', 'Z'] as const

const { t } = useI18n()
const basket = useSatelliteBasketStore()
const store = useCustomStatesStore()
const picks = useSatellitePicksStore()
const clock = useClockStore()
const form = ref(emptyStateForm(toUtcInput(clock.currentMs)))
const picker = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const importing = ref(false)
const failure = ref('')

const request = computed(() => stateRequest(form.value))

watch(form, () => (failure.value = ''), { deep: true })
onMounted(() => void store.load())

function epochLabel(epoch: string) {
  return `${formatUtc(Date.parse(epoch), false)} UTC`
}

function refOf(id: number): SatelliteRef {
  return { noradId: 0, customId: id, kind: 'state' }
}

function saved(created: CatalogDetail) {
  if (created.state_id != null) basket.add(refOf(created.state_id), created.name)
}

async function add() {
  if (busy.value || !request.value) return
  busy.value = true
  try {
    saved(await store.add(request.value))
    form.value = emptyStateForm(form.value.epoch)
  } catch (caught) {
    failure.value = apiErrorText(caught, t)
  } finally {
    busy.value = false
  }
}

function pick() {
  picker.value?.click()
}

async function chosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return
  importing.value = true
  failure.value = ''
  try {
    saved(await store.importFile(file))
  } catch (caught) {
    failure.value = apiErrorText(caught, t)
  } finally {
    importing.value = false
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
.file-row {
  display: flex;
}
.add-form {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.add-form .section-label {
  margin: 0;
}
.add-form > .v-btn {
  justify-self: end;
}
.triple {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-2);
}
/* Nine significant digits have to fit a third of the panel. */
.triple :deep(input) {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11.5px;
}
.triple :deep(.v-field__input) {
  padding-inline: var(--space-2);
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.delete {
  flex-shrink: 0;
  margin: -4px -4px -4px 0;
}
</style>
