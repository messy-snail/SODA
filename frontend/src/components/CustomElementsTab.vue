<template>
  <div class="form-stack">
    <v-btn-toggle
      v-model="kind"
      class="segmented"
      :aria-label="t('catalog.kinds.label')"
      data-testid="custom-kind"
    >
      <v-btn value="elements" data-testid="custom-kind-elements">
        {{ t('catalog.kinds.elements') }}
      </v-btn>
      <v-btn value="state" data-testid="custom-kind-state">{{ t('catalog.kinds.state') }}</v-btn>
      <v-btn value="ephemeris" data-testid="custom-kind-ephemeris">
        {{ t('catalog.kinds.ephemeris') }}
      </v-btn>
    </v-btn-toggle>
    <CustomStatesPanel v-if="kind === 'state'" />
    <CustomEphemeridesPanel v-else-if="kind === 'ephemeris'" />
    <template v-else>
      <div v-if="store.list.length" class="results" data-testid="custom-elements">
        <SatelliteRow
          v-for="item in store.list"
          :key="item.id"
          :sat-ref="{ noradId: item.norad_id, customId: item.id }"
          :name="item.name"
          :detail="`NORAD ${item.norad_id} · ${item.input_format.toUpperCase()} · ${epochLabel(item.epoch)}`"
          :category="item.category"
        >
          <template #append>
            <v-btn
              icon
              size="x-small"
              variant="text"
              class="delete"
              :aria-label="t('catalog.custom.delete', { name: item.name })"
              :data-testid="`custom-delete-${item.id}`"
              @click.stop="remove(item.id)"
            >
              <Trash2 :size="14" />
            </v-btn>
          </template>
        </SatelliteRow>
      </div>
      <p v-else class="empty-hint">{{ t('catalog.custom.empty') }}</p>

      <ElementFileImport @imported="imported" />

      <form class="add-form" @submit.prevent="add">
        <p class="section-label">{{ t('catalog.custom.add') }}</p>
        <v-text-field
          v-model="name"
          :label="t('catalog.custom.name')"
          maxlength="60"
          data-testid="custom-name"
        />
        <v-textarea
          v-model="text"
          :label="t('catalog.custom.text')"
          :hint="t('catalog.custom.hint')"
          persistent-hint
          variant="outlined"
          density="compact"
          rows="3"
          auto-grow
          spellcheck="false"
          class="mono-input"
          data-testid="custom-text"
        />
        <p v-if="failure" class="text-error text-caption" role="alert">{{ failure }}</p>
        <v-btn
          type="submit"
          color="primary"
          variant="tonal"
          :disabled="!name.trim() || !text.trim()"
          :loading="busy"
          data-testid="custom-save"
        >
          <Plus :size="15" class="mr-1" aria-hidden="true" />{{ t('common.save') }}
        </v-btn>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorText } from '../api/messages'
import type { ElementImportResult } from '../api/types'
import { useCustomElementsStore } from '../stores/customElements'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useSatellitePicksStore } from '../stores/satellitePicks'
import type { CustomKind } from '../utils/satelliteRef'
import { formatUtc } from '../utils/time'
import CustomEphemeridesPanel from './CustomEphemeridesPanel.vue'
import CustomStatesPanel from './CustomStatesPanel.vue'
import ElementFileImport from './ElementFileImport.vue'
import SatelliteRow from './SatelliteRow.vue'

const { t } = useI18n()
const basket = useSatelliteBasketStore()
const store = useCustomElementsStore()
const picks = useSatellitePicksStore()
/** Which kind of saved orbit source the tab shows. */
const kind = ref<CustomKind>('elements')
const name = ref('')
const text = ref('')
const busy = ref(false)
const failure = ref('')

watch([name, text], () => (failure.value = ''))
onMounted(() => void store.load())

function epochLabel(epoch: string) {
  return `${formatUtc(Date.parse(epoch), false)} UTC`
}

async function add() {
  if (busy.value) return
  busy.value = true
  try {
    const created = await store.add(name.value.trim(), text.value)
    name.value = ''
    text.value = ''
    basket.add({ noradId: created.norad_id, customId: created.custom_id ?? null }, created.name)
  } catch (caught) {
    failure.value = apiErrorText(caught, t)
  } finally {
    busy.value = false
  }
}

/** A file may hold more satellites than the basket takes, so only a lone one is picked. */
function imported(result: ElementImportResult) {
  if (result.created.length !== 1) return
  const [created] = result.created
  basket.add({ noradId: created.norad_id, customId: created.id }, created.name)
}

async function remove(id: number) {
  const ref = { noradId: 0, customId: id }
  await store.remove(id)
  picks.forget(ref)
  basket.remove(ref)
}
</script>

<style scoped>
.results {
  display: grid;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
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
.mono-input :deep(textarea) {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
}
.delete {
  flex-shrink: 0;
  margin: -4px -4px -4px 0;
}
</style>
