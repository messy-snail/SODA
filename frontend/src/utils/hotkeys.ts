/** Global keyboard shortcuts. The help menu lists the same keys (`components/HelpMenu.vue`). */
export type HotkeyAction =
  | 'togglePlay'
  | 'deselect'
  | 'toggleHelp'
  | 'home'
  | 'toggleSceneMode'
  | 'toggleLeft'
  | 'toggleBottom'

/** What the focused element is, reduced to what the shortcut rules need. */
export interface HotkeyTarget {
  /** Text entry: input, textarea, select or contenteditable. Every key belongs to it. */
  editable: boolean
  /** Buttons, links, sliders and similar: Space activates them, so it is not ours. */
  interactive: boolean
  /** A menu or dialog is open (or focused), so Escape closes that instead. */
  inOverlay: boolean
}

export interface HotkeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
  target: HotkeyTarget
}

/** Maps a keydown to a shortcut, or null when the key should be left alone. */
export function hotkeyAction(event: HotkeyInput): HotkeyAction | null {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.target.editable) return null
  switch (event.key) {
    case ' ':
      return event.target.interactive ? null : 'togglePlay'
    case 'Escape':
      return event.target.inOverlay ? null : 'deselect'
    case '?':
      return 'toggleHelp'
    case 'h':
    case 'H':
      return 'home'
    case 'm':
    case 'M':
      return 'toggleSceneMode'
    case '[':
      return 'toggleLeft'
    case 't':
    case 'T':
      return 'toggleBottom'
    default:
      return null
  }
}

const INTERACTIVE = 'button, a[href], summary, [role="button"], [role="slider"], [role="tab"]'
const EDITABLE = 'input, textarea, select'

/** Describes a DOM event target for `hotkeyAction`. */
export function describeTarget(target: EventTarget | null): HotkeyTarget {
  if (!(target instanceof Element)) return { editable: false, interactive: false, inOverlay: false }
  // Vuetify menus listen for Escape on the window, so an open one may not hold focus.
  return {
    editable: target.matches(EDITABLE) || (target as HTMLElement).isContentEditable === true,
    interactive: target.closest(INTERACTIVE) !== null,
    inOverlay:
      target.closest('.v-overlay__content') !== null ||
      document.querySelector('.v-overlay--active:not(.v-tooltip)') !== null,
  }
}
