import type { Viewer } from 'cesium'
import { useClockStore } from '../stores/clock'
import { useComparisonStore } from '../stores/comparison'
import { usePassesStore } from '../stores/passes'
import { useRunsStore } from '../stores/runs'
import { useSatelliteBasketStore } from '../stores/satelliteBasket'
import { useSelectionStore } from '../stores/selection'
import {
  loadSnapshot,
  reloadReason,
  saveSnapshot,
  snapshotStorage,
  type SessionSnapshot,
} from '../stores/sessionSnapshot'
import { useUiStore } from '../stores/ui'
import { persistenceSuspended } from '../utils/resetClientState'
import type { useViewControl } from './viewControl'

const SAVE_EVERY_MS = 2_000

/**
 * Restore the previous page load's working state on start, then keep it saved.
 *
 * Runs after the other layers exist, so the clock is attached (with any restored run's
 * range) and the view control can take the camera.
 */
export function useSessionRestore(viewer: Viewer, view: ReturnType<typeof useViewControl>) {
  const storage = snapshotStorage()
  const ui = useUiStore()
  const clock = useClockStore()
  const basket = useSatelliteBasketStore()
  const passes = usePassesStore()
  const selection = useSelectionStore()
  const comparison = useComparisonStore()
  const runs = useRunsStore()

  function capture(): SessionSnapshot {
    return {
      camera: viewer.trackedEntity ? null : view.snapshot(),
      sceneMode: ui.sceneMode,
      clock: { currentMs: clock.currentMs, playing: clock.playing, multiplier: clock.multiplier },
      activeTool: ui.activeTool,
      viewTab: ui.viewTab,
      basket: basket.entries.map((entry) => entry.key),
      stationIds: [...passes.selectedIds],
      swathToggles: { ...selection.toggles },
      comparison: comparison.enabled,
      trackedRunId: runs.trackedRunId,
      savedAtMs: Date.now(),
    }
  }

  function restore(snapshot: SessionSnapshot) {
    ui.activeTool = snapshot.activeTool
    if (snapshot.viewTab) ui.viewTab = snapshot.viewTab
    if (snapshot.clock) {
      clock.seek(snapshot.clock.currentMs)
      clock.setMultiplier(snapshot.clock.multiplier)
      clock.setPlaying(snapshot.clock.playing)
    }
    basket.restore(snapshot.basket)
    // The station list may still be loading; it keeps whichever of these still exist.
    if (snapshot.stationIds.length) passes.selectOnly(snapshot.stationIds)
    for (const [key, value] of Object.entries(snapshot.swathToggles)) {
      if (key in selection.toggles) (selection.toggles as Record<string, boolean>)[key] = value
    }
    comparison.enabled = snapshot.comparison
    if (snapshot.camera) view.restore(snapshot.camera, snapshot.sceneMode)
    else if (snapshot.sceneMode === '2d') ui.sceneMode = '2d'
    // Tracking takes the camera over, so it goes last.
    if (snapshot.trackedRunId) runs.track(snapshot.trackedRunId)
  }

  const previous = loadSnapshot(storage)
  if (previous) {
    restore(previous)
    const reason = reloadReason()
    console.info(`SODA: restored the previous session (navigation: ${reason ?? 'navigate'})`)
    if (reason) ui.restoreNotice = reason
  }

  let last = ''
  function save() {
    // A settings reset clears storage and reloads; saving now would bring the state back.
    if (!storage || viewer.isDestroyed() || persistenceSuspended()) return
    const snapshot = capture()
    // Compare without the timestamp so an idle page does not rewrite storage every tick.
    const text = JSON.stringify({ ...snapshot, savedAtMs: 0 })
    if (text === last) return
    last = text
    saveSnapshot(storage, snapshot)
  }

  const timer = storage ? setInterval(save, SAVE_EVERY_MS) : 0
  const onHide = () => {
    if (document.visibilityState === 'hidden') save()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', save)

  return {
    dispose() {
      save()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
    },
  }
}
