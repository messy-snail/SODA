import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { referenceTarget } from '../globe/referencePath'
import { useRunsStore } from './runs'
import { useClockStore } from './clock'

export const useComparisonStore = defineStore('comparison', () => {
  const runs = useRunsStore()
  const clock = useClockStore()
  const enabled = ref(true)
  const target = computed(() => referenceTarget(runs.runs, runs.selectedRunId))
  const reason = computed(() => {
    const run = target.value
    if (!run) return 'noTarget'
    if (!run.visible) return 'hidden'
    if (clock.currentMs < run.startMs || clock.currentMs > run.stopMs) return 'outside'
    if (clock.currentMs === run.stopMs) return 'finished'
    return null
  })
  return { enabled, target, reason }
})
