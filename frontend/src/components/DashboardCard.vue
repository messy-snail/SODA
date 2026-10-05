<template>
  <v-card
    class="dashboard-card"
    :class="{
      glass: !embedded,
      'dashboard-card--embedded': embedded,
      'dashboard-card--folded': folded,
      'dashboard-card--fill': fill,
    }"
  >
    <v-card-title class="card-heading">
      <span v-if="icon" class="card-icon"
        ><component :is="icon" :size="17" aria-hidden="true"
      /></span>
      <div :class="{ 'card-heading__toggle': sectionId }" @click="sectionId && toggle()">
        <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
        <h2>{{ title }}</h2>
      </div>
      <v-spacer />
      <slot name="append" />
      <v-btn
        v-if="sectionId"
        icon
        size="x-small"
        variant="text"
        class="fold-button"
        :aria-expanded="!folded"
        :aria-label="t(folded ? 'common.expand' : 'common.collapse', { name: title })"
        :data-testid="`fold-${sectionId}`"
        @click="toggle"
      >
        <ChevronDown :size="16" class="fold-chevron" aria-hidden="true" />
      </v-btn>
    </v-card-title>
    <v-card-text v-show="!folded"><slot /></v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { computed, inject, provide, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '../stores/ui'
import { EMBEDDED_CARD } from './cardEmbedding'

/**
 * `sectionId` makes the card foldable, like a section in an editor side bar. `fill` marks the
 * card that gives up height (and scrolls its body) when a panel's cards do not all fit.
 */
const props = defineProps<{
  title: string
  eyebrow?: string
  icon?: Component
  sectionId?: string
  fill?: boolean
}>()

const { t } = useI18n()
const ui = useUiStore()
/** A card inside another card (a tab of the view tool) drops its own glass and border. */
const embedded = inject(EMBEDDED_CARD, false)
provide(EMBEDDED_CARD, true)
const folded = computed(() => !!props.sectionId && ui.isCollapsed(props.sectionId))

function toggle() {
  if (props.sectionId) ui.toggleCollapsed(props.sectionId)
}
</script>
