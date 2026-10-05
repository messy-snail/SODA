<template>
  <v-tooltip location="bottom" max-width="300">
    <template #activator="{ props: tip }">
      <Info
        v-bind="{ ...tip, ...$attrs }"
        :size="14"
        class="info-tip muted"
        tabindex="0"
        :aria-label="label"
      />
    </template>
    <slot />
  </v-tooltip>
</template>

<script setup lang="ts">
import { Info } from 'lucide-vue-next'

/** An info icon whose explanation appears on hover or focus, instead of sitting in the panel. */
defineProps<{ label: string }>()
// Attributes such as a test id belong on the icon; the tooltip itself renders no element.
defineOptions({ inheritAttrs: false })
</script>

<style scoped>
.info-tip {
  flex: none;
  cursor: help;
}
</style>
