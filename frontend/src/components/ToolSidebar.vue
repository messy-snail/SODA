<template>
  <aside class="tool-sidebar glass glass--frame" data-testid="tool-sidebar" :aria-label="label">
    <slot />
  </aside>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { EMBEDDED_CARD } from './cardEmbedding'

/**
 * The editor-style side bar beside the tool rail: one glass pane down to the bottom edge,
 * with the tool's cards laid in as borderless sections.
 */
defineProps<{ label?: string }>()

provide(EMBEDDED_CARD, true)
</script>
