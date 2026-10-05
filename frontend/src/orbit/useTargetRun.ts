import { computed } from 'vue'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { hasElements, targetRun } from '../utils/satelliteRef'

/**
 * The satellite a single-satellite tool (storage, power, TC/TM) works on, by one rule for
 * all of them: the selected run when the tool can use it, else the first it can. Choosing
 * another one changes the selection for the whole app.
 */
export function useTargetRun(options: { elementsOnly: boolean }) {
  const runs = useRunsStore()

  const run = computed(() => targetRun(runs.selectedRun, runs.runs, options.elementsOnly))
  /** Runs the tool can work on, for its picker. */
  const eligible = computed(() =>
    options.elementsOnly ? runs.runs.filter(hasElements) : runs.runs,
  )
  /** The target, and the selected run when it had to be passed over. */
  const noted = computed(() =>
    [run.value, runs.selectedRun].filter(
      (item, index, list): item is OrbitRun => !!item && list.indexOf(item) === index,
    ),
  )

  function select(id: string | null) {
    if (id) runs.select(id)
  }

  return { run, eligible, noted, select }
}
