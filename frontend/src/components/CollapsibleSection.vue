<template>
  <section class="fold-section" :class="{ 'fold-section--folded': folded }">
    <button
      type="button"
      class="fold-section__head section-label"
      :aria-expanded="!folded"
      :data-testid="`fold-${id}`"
      @click="ui.toggleCollapsed(id)"
    >
      <ChevronDown :size="13" class="fold-chevron" aria-hidden="true" />
      <span>{{ title }}</span>
      <small v-if="folded && summary" class="fold-section__summary">{{ summary }}</small>
    </button>
    <div v-show="!folded" class="form-stack fold-section__body"><slot /></div>
  </section>
</template>

<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { computed } from 'vue'
import { useUiStore } from '../stores/ui'

/** A foldable block inside a card; `summary` stands in for the body while it is folded. */
const props = defineProps<{ id: string; title: string; summary?: string }>()

const ui = useUiStore()
const folded = computed(() => ui.isCollapsed(props.id))
</script>
