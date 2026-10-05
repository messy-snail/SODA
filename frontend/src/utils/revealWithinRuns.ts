import type { useClockStore } from '../stores/clock'
import type { OrbitRun } from '../stores/runs'

/**
 * Seek to ``ms`` without lifting the playback range. Runs propagated at different times
 * may each have set the range to their own window, so it is widened to cover every run
 * first; lifting it altogether would leave the globe with no orbit to draw.
 */
export function revealWithinRuns(
  clock: ReturnType<typeof useClockStore>,
  runs: readonly Pick<OrbitRun, 'startMs' | 'stopMs'>[],
  ms: number,
): void {
  if (clock.bounded && (ms < clock.startMs || ms > clock.stopMs) && runs.length) {
    const start = Math.min(...runs.map((run) => run.startMs))
    const stop = Math.max(...runs.map((run) => run.stopMs))
    clock.setRange(start, stop, false)
  }
  clock.reveal(ms)
}
