<template>
  <p v-if="without.length" class="text-caption sgp4-note" data-testid="needs-elements-note">
    <Info :size="13" aria-hidden="true" class="sgp4-note__icon" />
    {{ t('propagate.needsElements', { names: without.join(', ') }) }}
  </p>
  <p v-if="others.length" class="muted text-caption sgp4-note" data-testid="sgp4-only-note">
    <Info :size="13" aria-hidden="true" class="sgp4-note__icon" />
    {{ t('propagate.sgp4Only', { names: others.join(', ') }) }}
  </p>
</template>

<script setup lang="ts">
import { Info } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OrbitRun } from '../stores/runs'
import { hasElements } from '../utils/satelliteRef'

/**
 * Passes, imaging opportunities and the TC/TM link always propagate with SGP4. A run without
 * mean elements cannot be used at all; a run drawn by another propagator can, and this says
 * that its times may differ from the drawn orbit.
 */
const props = defineProps<{ runs: readonly OrbitRun[] }>()
const { t } = useI18n()
const without = computed(() => props.runs.filter((run) => !hasElements(run)).map((r) => r.name))
const others = computed(() =>
  props.runs.filter((run) => hasElements(run) && run.propagator !== 'sgp4').map((r) => r.name),
)
</script>

<style scoped>
.sgp4-note {
  margin: 0;
}
.sgp4-note__icon {
  vertical-align: -2px;
}
</style>
