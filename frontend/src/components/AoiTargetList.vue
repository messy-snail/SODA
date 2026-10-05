<template>
  <div>
    <p class="section-label">
      {{
        kind === 'box'
          ? t('mission.access.areas', { count: listed.length })
          : t('mission.access.targets', { count: targets.length, max: MAX_TARGETS })
      }}
    </p>
    <div class="target-list" data-testid="aoi-list">
      <div
        v-for="target in listed"
        :key="target.id"
        class="list-row"
        :class="{ selected: mission.focusedTargetId === target.id }"
      >
        <component
          :is="target.kind === 'box' ? SquareDashed : MapPin"
          :size="14"
          class="muted"
          aria-hidden="true"
        />
        <span class="grow">
          <strong>{{ target.name }}</strong>
          <small>{{ describe(target) }}</small>
          <small
            v-if="!kind && reasons.has(target.id)"
            class="reason"
            :data-reason="reasons.get(target.id)!.kind"
            data-testid="access-reason"
            >{{ reasons.get(target.id)!.text }}</small
          >
        </span>
        <v-btn
          icon
          size="x-small"
          variant="text"
          :aria-label="t('mission.access.fly')"
          @click="fly(target)"
        >
          <Crosshair :size="14" />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="text"
          :color="pinOf(target) ? 'primary' : undefined"
          :disabled="!pinOf(target) && pinsFull"
          :aria-pressed="!!pinOf(target)"
          :aria-label="pinLabel(target)"
          :title="pinLabel(target)"
          data-testid="aoi-to-pin"
          @click="toPin(target)"
        >
          <MapPinPlus :size="14" />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="text"
          :aria-label="t('mission.access.remove')"
          @click="mission.removeTarget(target.id)"
        >
          <Trash2 :size="14" />
        </v-btn>
      </div>
      <div v-if="!kind && !targets.length" class="empty-hint">
        {{ t('mission.access.noTargets') }}
      </div>
    </div>
    <div class="add-row">
      <v-btn
        v-if="!kind"
        size="small"
        variant="text"
        :disabled="full"
        :color="mission.placing === 'point' ? 'primary' : undefined"
        data-testid="aoi-add-point"
        @click="togglePlacing('point')"
      >
        <MapPin :size="14" class="mr-1" aria-hidden="true" />{{ t('mission.access.addPoint') }}
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :disabled="full"
        :color="mission.placing === 'box' ? 'primary' : undefined"
        data-testid="aoi-add-box"
        @click="togglePlacing('box')"
      >
        <SquareDashed :size="14" class="mr-1" aria-hidden="true" />{{ t('mission.access.addBox') }}
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :disabled="full"
        :aria-expanded="formOpen"
        data-testid="aoi-type"
        @click="toggleForm"
      >
        <component :is="formOpen ? ChevronUp : Keyboard" :size="14" class="mr-1" />{{
          t('mission.access.typeCoordinates')
        }}
      </v-btn>
      <v-menu
        v-if="!kind"
        location="bottom start"
        :offset="4"
        max-height="320"
        :close-on-content-click="false"
      >
        <template #activator="{ props: menu }">
          <v-btn v-bind="menu" size="small" variant="text" data-testid="aoi-from-pins">
            <MapPinned :size="14" class="mr-1" aria-hidden="true" />{{
              t('mission.access.fromPins')
            }}
          </v-btn>
        </template>
        <v-card class="pin-menu" data-testid="aoi-pin-menu">
          <button
            v-for="pin in pins"
            :key="pin.id"
            type="button"
            class="list-row"
            :class="{ selected: !!targetOf(pin) }"
            :disabled="!!targetOf(pin) || full"
            :aria-label="t('mission.access.addPin', { name: pin.name })"
            data-testid="aoi-pin-option"
            @click="fromPin(pin)"
          >
            <span class="glyph" :style="{ background: pinColor(pin.colorIndex) }">
              <component :is="PIN_GLYPHS[pin.icon]" :size="12" />
            </span>
            <span class="grow">
              <strong>{{ pin.name }}</strong>
              <small>{{ formatLatLon(pin.lat_deg, pin.lon_deg, 3) }}</small>
            </span>
            <Check v-if="targetOf(pin)" :size="15" class="text-primary" aria-hidden="true" />
          </button>
          <div v-if="!pins.length" class="empty-hint">
            {{ t('mission.access.fromPinsEmpty') }}
            <br />
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              class="mt-2"
              @click="ui.openTool('view', 'places')"
            >
              {{ t('mission.access.toPlaces') }}
            </v-btn>
          </div>
        </v-card>
      </v-menu>
    </div>
    <v-alert
      v-if="mission.placing"
      type="info"
      variant="tonal"
      density="compact"
      data-testid="aoi-placing"
    >
      {{ placingText }}
      <template #append>
        <v-btn size="x-small" variant="text" @click="mission.setPlacing(null)">
          {{ t('mission.access.cancelPlacing') }}
        </v-btn>
      </template>
    </v-alert>
    <AoiTargetForm v-if="formOpen" :only="kind" @close="formOpen = false" />
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronUp,
  Crosshair,
  Keyboard,
  MapPin,
  MapPinned,
  MapPinPlus,
  SquareDashed,
  Trash2,
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { findPinAt, findTarget, pinFromTarget, targetName } from '../mission/fromPlaces'
import {
  accessReason,
  boxWidthDeg,
  MAX_TARGETS,
  mergeDiagnoses,
  targetCenter,
  type ImagingTarget,
} from '../mission/targets'
import { PIN_GLYPHS } from '../places/pinIcons'
import { formatLatLon } from '../places/search'
import { useMissionStore, type PlacingMode } from '../stores/mission'
import { usePlacesStore } from '../stores/places'
import { MAX_PINS, type Pin } from '../stores/placesPersistence'
import { useUiStore } from '../stores/ui'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import AoiTargetForm from './AoiTargetForm.vue'

/**
 * The imaging targets and the ways to add one: a click on the globe, typed coordinates, or a
 * saved pin. A target can be saved back as a pin; both are copies that go their own way.
 */
const props = defineProps<{
  /** Only the areas, with only the ways to add one: what the coverage analysis works on. */
  kind?: 'box'
}>()

const { t } = useI18n()
const mission = useMissionStore()
const places = usePlacesStore()
const ui = useUiStore()
const theme = useThemePreset()
const formOpen = ref(false)

const targets = computed(() => mission.saved.targets)
/** The targets this list shows. */
const listed = computed(() =>
  props.kind ? targets.value.filter((target) => target.kind === props.kind) : targets.value,
)
const full = computed(() => targets.value.length >= MAX_TARGETS)
const pins = computed(() => places.saved.pins)
const pinsFull = computed(() => pins.value.length >= MAX_PINS)
const pinColor = (index: number) => stationColorHex(index, theme.preset.globe.pinPalette)

const placingText = computed(() => {
  if (mission.placing === 'point') return t('mission.access.placePoint')
  return t(mission.corner ? 'mission.access.placeBoxSecond' : 'mission.access.placeBoxFirst')
})

/**
 * One line per target of a fresh result: its windows over every satellite searched, or why
 * none of them has any.
 */
const reasons = computed(() => {
  const lines = new Map<string, { kind: string; text: string }>()
  if (mission.stale) return lines
  const { maxRollDeg, fovDeg, minSunElevDeg } = mission.saved
  const degrees = (value: number) => value.toFixed(1)
  for (const target of targets.value) {
    const found = mission.results.flatMap(({ response }) =>
      response.results.filter((result) => result.target_id === target.id),
    )
    if (!found.length) continue
    const windows = found.reduce((sum, result) => sum + result.windows.length, 0)
    const reason = accessReason(windows, mergeDiagnoses(found.map((result) => result.diagnosis)))
    const text =
      reason.kind === 'found'
        ? t(`mission.access.reason.${reason.dark ? 'foundDark' : 'found'}`, { ...reason })
        : reason.kind === 'dark'
          ? t('mission.access.reason.dark', {
              dark: reason.dark,
              sun: degrees(reason.sunDeg),
              min: minSunElevDeg,
            })
          : reason.kind === 'outOfReach'
            ? t('mission.access.reason.outOfReach', {
                roll: degrees(reason.rollDeg),
                reach: degrees(maxRollDeg + fovDeg / 2),
              })
            : t('mission.access.reason.noPass')
    lines.set(target.id, { kind: reason.kind, text })
  }
  return lines
})

function describe(target: ImagingTarget) {
  if (target.kind === 'point') {
    return `${target.lat_deg.toFixed(3)}°, ${target.lon_deg.toFixed(3)}°`
  }
  const width = boxWidthDeg(target).toFixed(1)
  const height = (target.north_deg - target.south_deg).toFixed(1)
  const center = targetCenter(target)
  return `${center.lat_deg.toFixed(2)}°, ${center.lon_deg.toFixed(2)}° · ${width}° × ${height}°`
}

function fly(target: ImagingTarget) {
  mission.focusedTargetId = target.id
  if (target.kind === 'point') {
    places.flyToPoint({ lat_deg: target.lat_deg, lon_deg: target.lon_deg, height_m: 1_500_000 })
  } else {
    places.flyToBbox([target.west_deg, target.south_deg, target.east_deg, target.north_deg])
  }
}

function togglePlacing(mode: PlacingMode) {
  formOpen.value = false
  mission.setPlacing(mission.placing === mode ? null : mode)
}

function toggleForm() {
  mission.setPlacing(null)
  formOpen.value = !formOpen.value
}

/** The point target already at a pin, if there is one. */
function targetOf(pin: Pin) {
  const { name, lat_deg, lon_deg } = pin
  return findTarget(targets.value, { kind: 'point', name, lat_deg, lon_deg })
}

function fromPin(pin: Pin) {
  mission.addPoint(pin.lat_deg, pin.lon_deg, targetName(pin.name) || undefined)
}

/** The pin already at a target (at the centre of a box), if there is one. */
function pinOf(target: ImagingTarget) {
  return findPinAt(pins.value, targetCenter(target))
}

function pinLabel(target: ImagingTarget) {
  if (pinOf(target)) return t('mission.access.isPin')
  return pinsFull.value ? t('places.pins.full', { max: MAX_PINS }) : t('mission.access.toPin')
}

/** Save the target as a pin; once it is one, the button shows it in the places tab. */
function toPin(target: ImagingTarget) {
  const pin = pinOf(target)
  if (!pin) {
    places.addPin(pinFromTarget(target))
    return
  }
  places.focusPin(pin.id)
  ui.openTool('view', 'places')
}
</script>

<style scoped>
.target-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.target-list .grow > small,
.pin-menu .grow > small {
  display: block;
}
/* A target without a window says why, a little louder than the ones that have some. */
.target-list .reason:not([data-reason='found']) {
  color: rgb(var(--v-theme-warning));
}
.add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: 2px 0 4px;
}
.pin-menu {
  display: grid;
  gap: 2px;
  min-width: 240px;
  padding: var(--space-1);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 12px !important;
  background: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
}
.pin-menu .list-row {
  text-align: left;
}
.pin-menu .list-row:disabled {
  cursor: default;
}
.glyph {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #fff;
}
</style>
