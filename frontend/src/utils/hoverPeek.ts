/** How long a popped-up dock stays after the pointer leaves, so it can cross the gap to it. */
export const PEEK_CLOSE_DELAY_MS = 250

export interface HoverPeek<K> {
  /** Pointer or focus on an icon or the popped-up piece: show `key` now. */
  enter(key: K): void
  /** Pointer left: hide after the delay unless something is entered again. */
  leave(): void
  /** Hide now (Escape, pinning), even while held. */
  close(): void
  /** Keep the shown piece up whatever the pointer does, e.g. while its menu is open. */
  hold(): void
  /** Stop holding; the caller calls `leave()` too when the pointer is no longer on the piece. */
  release(): void
}

/**
 * Hover-to-show state for docked pieces that live as icons: one piece at a time, closing a
 * little after the pointer leaves so moving from the icon onto the piece keeps it open.
 */
export function createHoverPeek<K>(
  set: (key: K | null) => void,
  delayMs = PEEK_CLOSE_DELAY_MS,
): HoverPeek<K> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let held = false

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }

  return {
    enter(key) {
      cancel()
      set(key)
    },
    leave() {
      cancel()
      if (held) return
      timer = setTimeout(() => {
        timer = undefined
        set(null)
      }, delayMs)
    },
    close() {
      cancel()
      held = false
      set(null)
    },
    hold() {
      cancel()
      held = true
    },
    release() {
      held = false
    },
  }
}
