import { onBeforeUnmount, onMounted } from 'vue'
import { useClockStore } from '../stores/clock'
import { usePassesStore } from '../stores/passes'
import { useRunsStore } from '../stores/runs'
import { useUiStore } from '../stores/ui'
import { describeTarget, hotkeyAction } from './hotkeys'

/** Installs the global keyboard shortcuts for the lifetime of the calling component. */
export function useHotkeys() {
  const clock = useClockStore()
  const runs = useRunsStore()
  const ui = useUiStore()
  const passes = usePassesStore()

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const action = hotkeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      isComposing: event.isComposing,
      target: describeTarget(event.target),
    })
    if (!action) return
    if (action === 'togglePlay') clock.setPlaying(!clock.playing)
    else if (action === 'deselect') {
      if (!runs.selectedRunId) return
      runs.select(null)
    } else if (action === 'home') ui.goHome()
    else if (action === 'toggleSceneMode') ui.toggleSceneMode()
    else if (action === 'toggleLeft') ui.toggleLeftPanel()
    else if (action === 'toggleBottom') {
      if (!passes.timelineOpen || !passes.result) return
      ui.timelinePinned = !ui.timelinePinned
    } else ui.helpOpen = !ui.helpOpen
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
