<template>
  <div class="imagery-row" :data-testid="`imagery-row-${item.id}`">
    <div class="row-head">
      <button
        type="button"
        class="row-title"
        :class="{ 'row-title--open': open }"
        :aria-expanded="open"
        :aria-label="t('imagery.details', { name })"
        :title="name"
        :data-testid="`imagery-toggle-${item.id}`"
        @click="open = !open"
      >
        <ChevronRight :size="13" class="row-chevron" aria-hidden="true" />
        <span
          v-if="active"
          class="showing-dot"
          :title="t('imagery.showing')"
          :data-testid="`imagery-showing-${item.id}`"
        />
        <strong>{{ name }}</strong>
      </button>
      <ImagerySensorChip
        v-if="item.sensor"
        :sensor="item.sensor"
        :data-testid="`imagery-sensor-chip-${item.id}`"
      />
      <v-chip
        v-if="ready && item.gsd_m !== null"
        size="x-small"
        variant="outlined"
        class="gsd"
        :title="t('imagery.resolution', { value: gsdLabel(item.gsd_m) })"
        :data-testid="`imagery-gsd-${item.id}`"
      >
        {{ gsdLabel(item.gsd_m) }}
      </v-chip>
      <v-btn
        v-if="ready"
        icon
        size="x-small"
        variant="text"
        :aria-label="t('imagery.flyTo', { name })"
        :title="t('imagery.flyTo', { name })"
        :data-testid="`imagery-fly-${item.id}`"
        @click="imagery.flyTo(item)"
      >
        <LocateFixed :size="15" />
      </v-btn>
      <!-- An import in flight or one that failed is cancelled or cleared without unfolding. -->
      <v-btn
        v-else
        icon
        size="x-small"
        variant="text"
        :disabled="busy"
        :aria-label="t(removeLabel, { name })"
        :title="t(removeLabel, { name })"
        :data-testid="`imagery-remove-${item.id}`"
        @click="remove"
      >
        <X :size="15" />
      </v-btn>
    </div>
    <template v-if="!ready">
      <small v-if="item.status === 'processing'" data-testid="imagery-processing">
        {{ t(`imagery.stage.${item.stage ?? 'tiling'}`, { percent }) }}
      </small>
      <small v-else class="text-error">{{ t('imagery.failed') }}</small>
      <v-progress-linear
        v-if="item.status === 'processing'"
        :model-value="percent"
        color="primary"
        height="2"
      />
    </template>
    <div v-if="open && ready" class="row-body" :data-testid="`imagery-body-${item.id}`">
      <small>
        <template v-if="item.sample">{{ t('imagery.sample') }} · </template
        >{{ t(`imagery.format.${item.source_format}`) }} · {{ meta }}
      </small>
      <small v-if="item.acquired_at">
        {{ t('imagery.acquired', { time: formatUtc(Date.parse(item.acquired_at), false) }) }}
      </small>
      <small v-if="item.license">
        {{ item.license }}
        <template v-if="isNonCommercial(item.license)">
          · {{ t('imagery.nonCommercial') }}</template
        >
      </small>
      <small v-if="active" class="showing">{{ t('imagery.showing') }}</small>
      <v-slider
        v-if="active"
        :model-value="pref.opacity"
        :min="0"
        :max="1"
        :step="0.05"
        :aria-label="t('imagery.opacity')"
        :data-testid="`imagery-opacity-${item.id}`"
        color="primary"
        density="compact"
        hide-details
        @update:model-value="layers.setImageryOpacity(item.id, $event)"
      >
        <template #prepend>
          <small class="slider-label">{{ t('imagery.opacity') }}</small>
        </template>
      </v-slider>
      <div v-if="!item.sample" class="row-actions">
        <v-btn
          icon
          size="x-small"
          variant="text"
          :aria-expanded="editing"
          :aria-label="t('imagery.edit', { name })"
          :title="t('imagery.edit', { name })"
          @click="toggleEdit"
        >
          <Pencil :size="15" />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="text"
          :disabled="busy"
          :aria-label="t(removeLabel, { name })"
          :title="t(removeLabel, { name })"
          :data-testid="`imagery-remove-${item.id}`"
          @click="remove"
        >
          <Trash2 :size="15" />
        </v-btn>
      </div>
      <div v-if="editing" class="form-stack edit">
        <v-text-field v-model="draft.name" :label="t('imagery.form.name')" maxlength="60" />
        <v-text-field
          v-model="draft.attribution"
          :label="t('imagery.form.attribution')"
          maxlength="200"
        />
        <v-text-field v-model="draft.license" :label="t('imagery.form.license')" maxlength="60" />
        <ImagerySensorToggle v-model="draft.sensor" />
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :loading="busy"
          :disabled="!draft.name.trim()"
          @click="save"
        >
          {{ t('imagery.save') }}
        </v-btn>
      </div>
    </div>
    <p v-if="message" class="text-error text-caption message">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, LocateFixed, Pencil, Trash2, X } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImagerySensor, ImagerySet } from '../api/types'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import { useImageryStore } from '../stores/imagery'
import { useLayersStore } from '../stores/layers'
import { gsdLabel, isNonCommercial } from '../utils/imagery'
import { formatBytes } from '../utils/namedFiles'
import { formatUtc } from '../utils/time'
import ImagerySensorChip from './ImagerySensorChip.vue'
import ImagerySensorToggle from './ImagerySensorToggle.vue'

/**
 * One set in the imagery list. Folded it is a single line: name, what took it, how sharp it
 * is, and the button that goes there. Unfolded it adds the details and what can be changed.
 */
const props = defineProps<{ item: ImagerySet }>()

const { t } = useI18n()
const imagery = useImageryStore()
const layers = useLayersStore()
const locale = useLocaleStore()

/** A sample is named in both languages; a user's own set has the one name they gave it. */
const name = computed(() =>
  props.item.label ? pick(props.item.label, locale.locale) : props.item.name,
)
const ready = computed(() => props.item.status === 'ready')
const pref = computed(() => layers.imageryPref(props.item.id))
/** On the globe right now, which takes the camera being zoomed in on the set. */
const active = computed(() => ready.value && imagery.active.has(props.item.id))
const percent = computed(() => Math.round((props.item.progress ?? 0) * 100))
const meta = computed(() =>
  t('imagery.meta', {
    min: props.item.min_zoom,
    max: props.item.max_zoom,
    count: (props.item.tile_count ?? 0).toLocaleString(),
    size: formatBytes(props.item.size_bytes ?? 0),
  }),
)
/** One button, three meanings: delete a set, cancel its import, or clear a failed one. */
const removeLabel = computed(() =>
  ready.value
    ? 'imagery.remove'
    : props.item.status === 'processing'
      ? 'imagery.cancel'
      : 'imagery.dismiss',
)

/** Unfolded; each row on its own, and not remembered. */
const open = ref(false)
const busy = ref(false)
const error = ref('')
const editing = ref(false)
const draft = reactive({
  name: '',
  attribution: '',
  license: '',
  sensor: '' as ImagerySensor | '',
})

/** The import's own failure, translated, or whatever the last action here reported. */
const message = computed(() => {
  if (error.value) return error.value
  const failure = props.item.error
  if (!failure) return ''
  const key = `errors.${failure.code}`
  const text = t(key, failure.params ?? {})
  return text === key ? failure.message : text
})

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

function toggleEdit() {
  editing.value = !editing.value
  draft.name = props.item.name
  draft.attribution = props.item.attribution
  draft.license = props.item.license
  draft.sensor = props.item.sensor ?? ''
}

function save() {
  void run(async () => {
    await imagery.update(props.item.id, {
      name: draft.name.trim(),
      attribution: draft.attribution.trim(),
      license: draft.license.trim(),
      acquired_at: props.item.acquired_at,
      sensor: draft.sensor,
    })
    editing.value = false
  })
}

function remove() {
  if (ready.value && !confirm(t('imagery.confirmDelete', { name: name.value }))) return
  void run(() => imagery.remove(props.item.id))
}
</script>

<style scoped>
.imagery-row {
  display: grid;
  /* Lets a long name be cut with an ellipsis instead of widening the row. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
  padding: 3px 4px 3px 6px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.row-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
}
.row-title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 2px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row-title:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}
.row-title strong {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-chevron {
  flex: none;
  color: rgb(var(--v-theme-secondary));
  transition: transform 0.12s;
}
.row-title--open .row-chevron {
  transform: rotate(90deg);
}
.showing-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}
.gsd {
  flex: none;
  /* Wide enough for `0.35 m`, so the chips of every row line up in columns. */
  justify-content: center;
  min-width: 52px;
  font-variant-numeric: tabular-nums;
}
.row-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: 0 4px 4px 20px;
}
.imagery-row small {
  display: block;
  overflow: hidden;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.imagery-row > small {
  padding-left: 20px;
}
.imagery-row small.showing {
  color: rgb(var(--v-theme-primary));
}
/* Room for the thumb at 100%, which otherwise hangs over the row's edge. */
.imagery-row :deep(.v-slider) {
  margin-inline: 0 var(--space-2);
}
.slider-label {
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
}
.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}
.edit {
  padding-top: var(--space-1);
}
.message {
  margin: 0;
  padding-left: 20px;
}
</style>
