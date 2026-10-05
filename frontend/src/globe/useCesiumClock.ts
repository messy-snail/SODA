import type { Viewer } from 'cesium'
import { useClockStore } from '../stores/clock'

const SYNC_INTERVAL_MS = 100

/** Mirror the Cesium clock into Pinia at most every 100 ms. */
export function useCesiumClock(viewer: Viewer) {
  const clock = useClockStore()
  clock.attach(viewer.clock)
  let last = 0
  const remove = viewer.clock.onTick.addEventListener(() => {
    const now = performance.now()
    if (now - last < SYNC_INTERVAL_MS) return
    last = now
    clock.sync()
  })
  return {
    dispose() {
      remove()
      clock.detach()
    },
  }
}
