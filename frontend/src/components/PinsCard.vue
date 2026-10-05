<template>
  <DashboardCard
    section-id="places.pins"
    fill
    :title="t('places.pins.title')"
    eyebrow="PINS"
    :icon="MapPinned"
  >
    <div class="form-stack">
      <p v-if="places.placing" class="text-caption text-primary">
        {{ t('places.pins.placingHint') }}
      </p>
      <v-text-field
        v-model="form.name"
        :label="t('places.pins.name')"
        :placeholder="namePlaceholder"
        persistent-placeholder
        data-testid="pin-name"
      />
      <div class="coord-row">
        <v-text-field
          v-model.number="form.lat_deg"
          type="number"
          :label="t('places.pins.latitude')"
          data-testid="pin-lat"
          @keydown.enter="preview"
        />
        <v-text-field
          v-model.number="form.lon_deg"
          type="number"
          :label="t('places.pins.longitude')"
          data-testid="pin-lon"
          @keydown.enter="preview"
        />
        <v-btn
          icon
          size="small"
          variant="tonal"
          :disabled="!valid"
          :aria-label="t('places.pins.preview')"
          :title="t('places.pins.preview')"
          data-testid="pin-preview"
          @click="preview"
        >
          <LocateFixed :size="16" />
        </v-btn>
        <v-btn
          icon
          size="small"
          :variant="places.placing ? 'flat' : 'tonal'"
          :color="places.placing ? 'primary' : undefined"
          :aria-pressed="places.placing"
          :aria-label="t('places.pins.placeOnGlobe')"
          :title="t('places.pins.placeOnGlobe')"
          data-testid="pin-placing"
          @click="places.setPlacing(!places.placing)"
        >
          <Crosshair :size="16" />
        </v-btn>
      </div>
      <p v-if="hasCandidate" class="text-caption text-primary">
        {{ t('places.pins.candidateHint') }}
      </p>
      <PinStylePicker v-model:icon="form.icon" v-model:color-index="form.colorIndex" allow-auto />
      <div class="actions">
        <v-btn variant="text" :disabled="full" data-testid="pin-add-view" @click="addCurrentView">
          {{ t('places.pins.addCurrentView') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="!valid || full"
          data-testid="pin-add"
          @click="add"
        >
          <Plus :size="14" class="mr-1" aria-hidden="true" />{{
            hasCandidate ? t('places.pins.addHere') : t('places.pins.add')
          }}
        </v-btn>
      </div>
      <p v-if="full" class="text-caption text-warning">
        {{ t('places.pins.full', { max: MAX_PINS }) }}
      </p>

      <div v-if="places.saved.pins.length" class="pins" data-testid="pin-list">
        <div
          v-for="pin in places.saved.pins"
          :key="pin.id"
          :ref="(el) => rememberRow(pin.id, el)"
          class="pin-entry"
          :class="{ focused: places.focusedPinId === pin.id }"
        >
          <div class="list-row" :class="{ hidden: !pin.visible }">
            <span class="glyph" :style="{ background: colorOf(pin.colorIndex) }">
              <component :is="PIN_GLYPHS[pin.icon]" :size="14" />
            </span>
            <button type="button" class="grow row-main" data-testid="pin-go" @click="go(pin)">
              <strong>{{ pin.name }}</strong>
              <small>{{ formatLatLon(pin.lat_deg, pin.lon_deg, 3) }}</small>
            </button>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :aria-label="pin.visible ? t('places.pins.hide') : t('places.pins.show')"
              :title="pin.visible ? t('places.pins.hide') : t('places.pins.show')"
              data-testid="pin-visible"
              @click="places.togglePin(pin.id)"
            >
              <component :is="pin.visible ? Eye : EyeOff" :size="14" />
            </v-btn>
            <AddTargetButton
              :candidate="{
                kind: 'point',
                name: pin.name,
                lat_deg: pin.lat_deg,
                lon_deg: pin.lon_deg,
              }"
              test-id="pin-to-target"
            />
            <v-btn
              icon
              size="x-small"
              variant="text"
              :aria-label="t('places.pins.edit')"
              data-testid="pin-edit"
              @click="editing = editing === pin.id ? null : pin.id"
            >
              <Pencil :size="14" />
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :aria-label="t('places.pins.remove')"
              @click="places.removePin(pin.id)"
            >
              <Trash2 :size="14" />
            </v-btn>
          </div>
          <div v-if="editing === pin.id" class="editor form-stack">
            <v-text-field
              :model-value="pin.name"
              :label="t('places.pins.name')"
              density="compact"
              hide-details
              data-testid="pin-edit-name"
              @update:model-value="(name: string) => places.updatePin(pin.id, { name })"
            />
            <PinStylePicker
              :icon="pin.icon"
              :color-index="pin.colorIndex"
              @update:icon="(icon) => places.updatePin(pin.id, { icon })"
              @update:color-index="
                (colorIndex) => colorIndex !== null && places.updatePin(pin.id, { colorIndex })
              "
            />
            <v-btn size="small" variant="text" class="done" @click="editing = null">
              {{ t('places.pins.done') }}
            </v-btn>
          </div>
        </div>
      </div>
      <div v-else class="empty-hint">{{ t('places.pins.empty') }}</div>
    </div>
  </DashboardCard>
</template>

<script setup lang="ts">
import {
  Crosshair,
  Eye,
  EyeOff,
  LocateFixed,
  MapPinned,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CITY_HEIGHT_M } from '../places/camera'
import { PIN_GLYPHS, type PinIcon } from '../places/pinIcons'
import { formatLatLon } from '../places/search'
import { usePlacesStore } from '../stores/places'
import { useUiStore } from '../stores/ui'
import { MAX_PINS, type Pin } from '../stores/placesPersistence'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import AddTargetButton from './AddTargetButton.vue'
import DashboardCard from './DashboardCard.vue'
import PinStylePicker from './PinStylePicker.vue'

const { t } = useI18n()
const places = usePlacesStore()
const ui = useUiStore()
const theme = useThemePreset()
const editing = ref<string | null>(null)
const form = reactive({
  name: '',
  lat_deg: null as number | null,
  lon_deg: null as number | null,
  icon: 'pin' as PinIcon,
  colorIndex: null as number | null,
})

onMounted(() => void places.loadNaming())
// Leaving the panel ends placing mode, so a later click on the globe picks as usual.
onBeforeUnmount(() => {
  places.setPlacing(false)
  places.clearDraft()
})

const full = computed(() => places.saved.pins.length >= MAX_PINS)

const inRange = (value: number | null, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high

const valid = computed(() => inRange(form.lat_deg, -90, 90) && inRange(form.lon_deg, -180, 180))

/** The default name shows as the placeholder, so the reader sees what an empty name gives. */
const namePlaceholder = computed(() =>
  valid.value
    ? t('places.pins.namePlaceholder', {
        name: places.suggestName(form.lon_deg!, form.lat_deg!),
      })
    : t('places.pins.nameAuto'),
)

/** Form values keep 5 decimals, so a candidate matches the form within that. */
const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-5

/** The ring on the globe marks where "add" puts the pin. */
const hasCandidate = computed(() => {
  const point = places.draft
  return !!point && same(form.lat_deg, point.lat_deg) && same(form.lon_deg, point.lon_deg)
})

// A candidate from a globe click or a search result fills the form; a typed name stays
// unless the search result suggests one.
watch(
  () => places.draft,
  (point) => {
    if (!point) return
    form.lat_deg = +point.lat_deg.toFixed(5)
    form.lon_deg = +point.lon_deg.toFixed(5)
    if (point.name !== undefined) form.name = point.name
    if (point.icon) form.icon = point.icon
    if (ui.isCollapsed('places.pins')) ui.toggleCollapsed('places.pins')
  },
  { immediate: true },
)

// Typing other coordinates drops the ring, so it never marks a place "add" will not use.
watch(
  () => [form.lat_deg, form.lon_deg],
  () => {
    if (places.draft && !hasCandidate.value) places.clearDraft()
  },
)

/** Fly to the typed coordinates and ring them, so the user sees the spot before adding. */
function preview() {
  if (!valid.value) return
  const point = { lon_deg: form.lon_deg!, lat_deg: form.lat_deg! }
  places.setDraft(point.lon_deg, point.lat_deg)
  places.flyToPoint({ ...point, height_m: CITY_HEIGHT_M })
}

function resetForm() {
  form.name = ''
  form.lat_deg = null
  form.lon_deg = null
}

function add() {
  if (!valid.value) return
  const id = places.addPin({
    name: form.name,
    icon: form.icon,
    colorIndex: form.colorIndex,
    lat_deg: form.lat_deg!,
    lon_deg: form.lon_deg!,
  })
  if (id) {
    resetForm()
    places.setPlacing(false)
    places.clearDraft()
  }
}

function addCurrentView() {
  places.requestPinCapture({ name: form.name, icon: form.icon, colorIndex: form.colorIndex })
  form.name = ''
}

function go(pin: Pin) {
  places.focusPin(pin.id)
  places.flyToPoint(pin)
}

function colorOf(index: number): string {
  return stationColorHex(index, theme.preset.globe.pinPalette)
}

// A pin clicked on the globe scrolls into view here.
const rows = new Map<string, Element>()
function rememberRow(id: string, el: unknown) {
  if (el instanceof Element) rows.set(id, el)
  else rows.delete(id)
}
watch(
  () => places.focusedPinId,
  async (id) => {
    if (!id) return
    await nextTick()
    rows.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
  { immediate: true },
)
</script>

<style scoped>
.coord-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto auto;
  gap: var(--space-2);
  align-items: center;
}
.coord-row > .v-input {
  min-width: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}
.pins {
  display: grid;
  gap: 2px;
  max-height: 340px;
  overflow-y: auto;
}
.pin-entry.focused .list-row {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.08);
}
.list-row.hidden .row-main,
.list-row.hidden .glyph {
  opacity: 0.45;
}
.glyph {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #fff;
}
.row-main {
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
/* Four buttons leave the name little room; the coordinates stay on one line. */
.row-main > strong,
.row-main > small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor {
  padding: 8px 10px 4px;
}
.done {
  justify-self: end;
}
</style>
