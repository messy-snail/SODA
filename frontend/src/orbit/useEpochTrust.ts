import { computed } from 'vue'
import { useClockStore } from '../stores/clock'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { hasElements } from '../utils/satelliteRef'
import { daysFromEpoch, trustBands, trustLevel, trustReferenceRun } from './epochTrust'

export function runEpochMs(run: OrbitRun): number {
  return Date.parse(run.data.element_set.epoch)
}

/**
 * Element-age grade at the clock's current time, for the run the globe-wide indicators follow
 * (the selected run, otherwise the worst visible one), plus its grade bands over the clock range.
 */
export function useEpochTrust() {
  const runs = useRunsStore()
  const clock = useClockStore()

  const reference = computed(() => {
    // The grades are about mean elements ageing; a state vector run is not graded.
    const sources = runs.runs.filter(hasElements).map((run) => ({
      id: run.id,
      visible: run.visible,
      epochMs: runEpochMs(run),
      run,
    }))
    return trustReferenceRun(sources, runs.selectedRunId, clock.currentMs)
  })

  const level = computed(() =>
    reference.value ? trustLevel(reference.value.epochMs, clock.currentMs) : 'ok',
  )
  const days = computed(() =>
    reference.value ? daysFromEpoch(reference.value.epochMs, clock.currentMs) : 0,
  )
  const bands = computed(() =>
    reference.value ? trustBands(reference.value.epochMs, clock.startMs, clock.stopMs) : [],
  )

  return { reference, level, days, bands }
}
