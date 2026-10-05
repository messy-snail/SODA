import { computed } from 'vue'
import { useClockStore } from '../stores/clock'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { eclipsedAt, eclipseIntervals } from './eclipse'

/** The run whose eclipses the map and the clock bar show: the selected one, else the first shown. */
export function eclipseReferenceRun(
  runs: readonly OrbitRun[],
  selected: OrbitRun | null,
): OrbitRun | null {
  return selected ?? runs.find((run) => run.visible) ?? null
}

/** Eclipse intervals of the followed run in epoch ms, and whether the clock is inside one. */
export function useEclipse() {
  const runs = useRunsStore()
  const clock = useClockStore()

  const reference = computed(() => eclipseReferenceRun(runs.runs, runs.selectedRun))
  /** Flat `[enter0, exit0, ...]`, or null when the run carries no eclipse data. */
  const intervalsMs = computed(() => {
    const run = reference.value
    const seconds = run ? eclipseIntervals(run.data) : null
    return run && seconds ? seconds.map((value) => run.startMs + value * 1000) : null
  })
  const eclipsedNow = computed(() =>
    intervalsMs.value ? eclipsedAt(intervalsMs.value, clock.currentMs) : false,
  )

  return { reference, intervalsMs, eclipsedNow }
}
