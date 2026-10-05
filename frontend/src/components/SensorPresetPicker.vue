<template>
  <div class="preset-grid" role="radiogroup" :aria-label="t('swath.preset')">
    <div v-for="tile in tiles" :key="tile.id" class="preset-cell">
      <button
        type="button"
        role="radio"
        class="preset-tile"
        :class="{ 'preset-tile--on': tile.id === modelValue, 'preset-tile--saved': tile.saved }"
        :aria-checked="tile.id === modelValue"
        :data-testid="`sensor-preset-${tile.id}`"
        @click="emit('update:modelValue', tile.id)"
      >
        <strong>
          <Bookmark v-if="tile.saved" :size="11" aria-hidden="true" />
          {{ tile.title }}
        </strong>
        <small>
          <PenLine v-if="tile.id === 'custom'" :size="12" aria-hidden="true" />
          {{ tile.summary }}
        </small>
      </button>
      <button
        v-if="tile.saved"
        type="button"
        class="preset-delete"
        :aria-label="t('swath.deletePreset', { name: tile.title })"
        :title="t('swath.deletePreset', { name: tile.title })"
        :data-testid="`sensor-preset-delete-${tile.id}`"
        @click="emit('delete', tile.id)"
      >
        <X :size="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Bookmark, PenLine, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { pick } from '../i18n/label'
import { useLocaleStore } from '../i18n/useLocale'
import { presetSummary, sensorPresets, type UserSensorPreset } from '../sensors/presets'

const props = defineProps<{ modelValue: string; saved: readonly UserSensorPreset[] }>()
const emit = defineEmits<{ 'update:modelValue': [id: string]; delete: [id: string] }>()
const { t } = useI18n()
const locale = useLocaleStore()

/** Built-in presets, the user's saved ones, then a tile that keeps the values for editing. */
const tiles = computed(() => [
  ...sensorPresets.map((preset) => ({
    id: preset.id,
    title: pick(preset.label, locale.locale),
    summary: presetSummary(preset.settings),
    saved: false,
  })),
  ...props.saved.map((preset) => ({
    id: preset.id,
    title: preset.name,
    summary: presetSummary(preset.settings),
    saved: true,
  })),
  {
    id: 'custom',
    title: t('swath.presetCustom'),
    summary: t('swath.presetCustomHint'),
    saved: false,
  },
])
</script>

<style scoped>
.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}
.preset-cell {
  position: relative;
  display: grid;
}
.preset-tile {
  display: grid;
  gap: 2px;
  padding: 9px 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms,
    background 140ms;
}
.preset-tile:hover {
  border-color: rgba(var(--v-theme-primary), 0.35);
}
.preset-tile:focus-visible,
.preset-delete:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
.preset-tile--on {
  border-color: rgba(var(--v-theme-primary), 0.6);
  background: rgba(var(--v-theme-primary), 0.1);
}
.preset-tile--saved {
  padding-right: 26px;
}
.preset-tile strong {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preset-tile--on strong {
  color: rgb(var(--v-theme-primary));
}
.preset-tile small {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: rgb(var(--v-theme-secondary));
  font-variant-numeric: tabular-nums;
}
/* Delete sits over the tile's corner and only shows while the tile is pointed at or focused. */
.preset-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgb(var(--v-theme-secondary));
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms;
}
.preset-cell:hover .preset-delete,
.preset-cell:focus-within .preset-delete {
  opacity: 1;
}
.preset-delete:hover {
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
}
</style>
