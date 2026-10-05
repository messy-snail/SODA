<template>
  <div class="sat-item" :class="{ 'sat-item--open': open }">
    <div
      role="checkbox"
      tabindex="0"
      class="list-row sat-row"
      :class="{ selected: picked, 'sat-row--blocked': blocked }"
      :aria-checked="picked"
      :aria-disabled="blocked"
      :title="blocked ? t('catalog.basketFull', { max: MAX_BASKET }) : undefined"
      :data-testid="`satellite-row-${key}`"
      @click="toggle"
      @keydown.enter.self="toggle"
      @keydown.space.self.prevent="toggle"
    >
      <component
        :is="picked ? SquareCheck : Square"
        :size="17"
        class="tick"
        :class="{ 'text-primary': picked }"
        aria-hidden="true"
      />
      <span v-if="color" class="color-dot" :style="{ background: color }" />
      <span class="grow">
        <strong>{{ name }}</strong>
        <small>{{ detail }}</small>
      </span>
      <v-chip v-if="category" :color="layers.categoryColors[category]">{{ category }}</v-chip>
      <slot name="append" />
      <v-btn
        icon
        size="x-small"
        variant="text"
        class="expand"
        :aria-expanded="open"
        :aria-label="t(open ? 'catalog.hideFacts' : 'catalog.showFacts', { name })"
        :data-testid="`satellite-expand-${key}`"
        @click.stop="open = !open"
      >
        <ChevronDown :size="15" class="chevron" />
      </v-btn>
    </div>
    <SatelliteFacts v-if="open" :sat-ref="satRef" />
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, Square, SquareCheck } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '../api/types'
import { MAX_BASKET } from '../stores/basketItems'
import { useLayersStore } from '../stores/layers'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { satKey, type SatelliteRef } from '../utils/satelliteRef'
import SatelliteFacts from './SatelliteFacts.vue'

const props = defineProps<{
  satRef: SatelliteRef
  name: string
  detail: string
  category?: Category
  /** Orbit colour, for rows that stand for a run-to-be. */
  color?: string
}>()
const { t } = useI18n()
const layers = useLayersStore()
const basket = useSatelliteBasketStore()
const open = ref(false)

const key = computed(() => satKey(props.satRef))
const picked = computed(() => basket.has(props.satRef))
const blocked = computed(() => !picked.value && basket.full)

function toggle() {
  if (!blocked.value) basket.toggle(props.satRef, props.name)
}
</script>

<style scoped>
.sat-item {
  display: grid;
  border-radius: 10px;
}
.sat-item--open {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.tick {
  flex-shrink: 0;
  opacity: 0.8;
}
.sat-row--blocked {
  cursor: not-allowed;
  opacity: 0.55;
}
.expand {
  flex-shrink: 0;
  margin: -4px -6px -4px -2px;
}
.chevron {
  transition: transform 160ms;
}
.sat-item--open .chevron {
  transform: rotate(180deg);
}
</style>
