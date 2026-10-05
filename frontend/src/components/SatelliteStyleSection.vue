<template>
  <div class="style-section">
    <div class="slider-row">
      <span>{{ t('markers.style.pointSize') }}</span>
      <v-slider
        v-model="style.pointSize"
        :min="POINT_SIZE_RANGE[0]"
        :max="POINT_SIZE_RANGE[1]"
        :step="0.5"
        color="primary"
        hide-details
        density="compact"
        :aria-label="t('markers.style.pointSize')"
      />
      <output>{{ style.pointSize.toFixed(1) }}px</output>
    </div>
    <div class="slider-row">
      <span>{{ t('markers.style.opacity') }}</span>
      <v-slider
        v-model="style.opacity"
        :min="OPACITY_RANGE[0]"
        :max="OPACITY_RANGE[1]"
        :step="0.05"
        color="primary"
        hide-details
        density="compact"
        :aria-label="t('markers.style.opacity')"
      />
      <output>{{ Math.round(style.opacity * 100) }}%</output>
    </div>

    <div class="categories">
      <div
        v-for="category in CATEGORIES"
        :key="category"
        class="category"
        :class="{ off: style.hidden.includes(category) }"
      >
        <v-checkbox-btn
          :model-value="!style.hidden.includes(category)"
          density="compact"
          color="primary"
          :aria-label="t('markers.style.show', { category })"
          @update:model-value="layers.toggleCategory(category)"
        />
        <v-menu :close-on-content-click="false" location="end">
          <template #activator="{ props }">
            <button
              v-bind="props"
              type="button"
              class="swatch"
              :style="{ background: layers.categoryColors[category] }"
              :aria-label="t('markers.style.changeColor', { category })"
            />
          </template>
          <v-card class="picker-card">
            <v-color-picker
              :model-value="layers.categoryColors[category]"
              mode="hex"
              :modes="['hex']"
              elevation="0"
              @update:model-value="(value: string) => layers.setCategoryColor(category, value)"
            />
            <v-btn
              block
              size="small"
              variant="tonal"
              :disabled="!style.colors[category]"
              @click="layers.setCategoryColor(category, null)"
            >
              {{ t('markers.style.themeColor') }}
            </v-btn>
          </v-card>
        </v-menu>
        <span class="name">{{ category }}</span>
        <small v-if="style.colors[category]" class="muted">{{
          t('markers.style.userColor')
        }}</small>
      </div>
    </div>

    <v-btn
      size="small"
      variant="text"
      class="reset"
      :disabled="isDefault"
      @click="layers.resetCloudStyle()"
    >
      <RotateCcw :size="14" class="mr-1" aria-hidden="true" />{{ t('markers.style.reset') }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '../stores/layers'
import {
  CATEGORIES,
  defaultCloudStyle,
  OPACITY_RANGE,
  POINT_SIZE_RANGE,
} from '../theme/categoryColors'

const { t } = useI18n()
const layers = useLayersStore()
const style = computed(() => layers.prefs.cloudStyle)
const isDefault = computed(
  () => JSON.stringify(layers.prefs.cloudStyle) === JSON.stringify(defaultCloudStyle()),
)
</script>

<style scoped>
.style-section {
  display: grid;
  gap: 4px;
}
.slider-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.slider-row output {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-secondary));
}
.categories {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-1) var(--space-3);
  margin-top: 2px;
}
.category {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.category :deep(.v-selection-control) {
  flex: 0 0 auto;
}
.category.off .name,
.category.off .swatch {
  opacity: 0.4;
}
.category small {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swatch {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 50%;
  cursor: pointer;
}
.swatch:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.name {
  font-weight: 650;
}
.picker-card {
  display: grid;
  gap: 8px;
  padding: 8px;
}
.reset {
  justify-self: start;
}
</style>
