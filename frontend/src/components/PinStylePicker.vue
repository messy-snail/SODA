<template>
  <div class="pin-style">
    <div class="choices" role="radiogroup" :aria-label="t('places.pins.icon')">
      <button
        v-for="id in PIN_ICONS"
        :key="id"
        type="button"
        role="radio"
        class="choice"
        :class="{ active: icon === id }"
        :aria-checked="icon === id"
        :aria-label="t(`places.pins.icons.${id}`)"
        :title="t(`places.pins.icons.${id}`)"
        :data-testid="`pin-icon-${id}`"
        @click="emit('update:icon', id)"
      >
        <component :is="PIN_GLYPHS[id]" :size="16" />
      </button>
    </div>
    <div class="choices" role="radiogroup" :aria-label="t('places.pins.color')">
      <button
        v-if="allowAuto"
        type="button"
        role="radio"
        class="swatch auto"
        :class="{ active: colorIndex === null }"
        :aria-checked="colorIndex === null"
        :title="t('places.pins.autoColor')"
        @click="emit('update:colorIndex', null)"
      >
        {{ t('places.pins.autoColor') }}
      </button>
      <button
        v-for="(color, index) in palette"
        :key="color"
        type="button"
        role="radio"
        class="swatch"
        :class="{ active: colorIndex !== null && colorIndex % palette.length === index }"
        :aria-checked="colorIndex !== null && colorIndex % palette.length === index"
        :aria-label="`${t('places.pins.color')} ${index + 1}`"
        :style="{ background: color }"
        :data-testid="`pin-color-${index}`"
        @click="emit('update:colorIndex', index)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PIN_GLYPHS, PIN_ICONS, type PinIcon } from '../places/pinIcons'
import { useThemePreset } from '../theme/useThemePreset'

defineProps<{ icon: PinIcon; colorIndex: number | null; allowAuto?: boolean }>()
const emit = defineEmits<{
  'update:icon': [PinIcon]
  'update:colorIndex': [number | null]
}>()

const { t } = useI18n()
const theme = useThemePreset()
const palette = computed(() => theme.preset.globe.pinPalette)
</script>

<style scoped>
.pin-style {
  display: grid;
  gap: 8px;
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.choice {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
}
.choice.active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.swatch {
  width: 24px;
  height: 24px;
  border: 2px solid transparent;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.swatch.auto {
  width: auto;
  padding: 0 8px;
  border-radius: 12px;
  font-size: 11px;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.2);
}
.swatch.active {
  border-color: rgb(var(--v-theme-on-surface));
}
</style>
