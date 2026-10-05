import {
  Aperture,
  BatteryCharging,
  Box,
  Grid3x3,
  HardDrive,
  Layers,
  RadioTower,
  Satellite,
  SatelliteDish,
  ScanLine,
} from 'lucide-vue-next'
import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef, watch, type Component } from 'vue'
import { COVERAGE, GLB_MODELS } from '../features'
import type { ScaleBar } from '../globe/scaleBar'
import { createHoverPeek } from '../utils/hoverPeek'

export type ToolId =
  | 'satellite'
  | 'swath'
  | 'passes'
  | 'imaging'
  | 'coverage'
  | 'storage'
  | 'power'
  | 'tmtc'
  | 'view'
  | 'models'

/** Pages of the `satellite` tool, in the order one works through them. */
export type SatelliteStep = 'pick' | 'propagate' | 'runs'
export const SATELLITE_STEPS: readonly SatelliteStep[] = ['pick', 'propagate', 'runs']

/** Tabs of the `view` tool: how the globe looks, where it goes, how satellites are drawn. */
export type ViewTab = 'layers' | 'imagery' | 'places' | 'markers'
export const VIEW_TABS: readonly ViewTab[] = ['layers', 'imagery', 'places', 'markers']

export function isViewTab(value: unknown): value is ViewTab {
  return typeof value === 'string' && (VIEW_TABS as readonly string[]).includes(value)
}

/** Tabs of the `imaging` tool: what to image, and when it can be imaged. */
export type ImagingTab = 'targets' | 'results'
export const IMAGING_TABS: readonly ImagingTab[] = ['targets', 'results']

/** Where clicking a contact or pass puts the clock: its AOS, or its culmination (TCA). */
export type ContactJump = 'aos' | 'tca'

export interface Tool {
  id: ToolId
  icon: Component
}

/** Names live in the message catalogue under `app.tool.<id>`; the rail resolves them. */
const allTools: Tool[] = [
  { id: 'satellite', icon: markRaw(Satellite) },
  { id: 'swath', icon: markRaw(ScanLine) },
  { id: 'passes', icon: markRaw(RadioTower) },
  { id: 'imaging', icon: markRaw(Aperture) },
  { id: 'coverage', icon: markRaw(Grid3x3) },
  { id: 'storage', icon: markRaw(HardDrive) },
  { id: 'power', icon: markRaw(BatteryCharging) },
  { id: 'tmtc', icon: markRaw(SatelliteDish) },
  { id: 'view', icon: markRaw(Layers) },
  { id: 'models', icon: markRaw(Box) },
]

/** Tools left out of the rail unless enabled at build time. */
const HIDDEN: Partial<Record<ToolId, boolean>> = { models: !GLB_MODELS, coverage: !COVERAGE }

/** Tools in the rail. */
export const tools = allTools.filter((tool) => !HIDDEN[tool.id])

export type SceneMode = '3d' | '2d'

/** Pieces of the bottom dock that can live as an icon. */
export type DockPiece = 'timeline' | 'clock'

/** Which panels and sections are folded, kept across reloads like an editor layout. */
export interface PanelLayout {
  /** Folded card or section ids (`DashboardCard`'s `sectionId`, `CollapsibleSection`'s `id`). */
  collapsed: string[]
  /** The pass timeline stays in the bottom dock instead of an icon that pops it up on hover. */
  timelinePinned: boolean
  /** The clock bar stays in the bottom dock instead of an icon that pops it up on hover. */
  clockPinned: boolean
  /** Tab the view tool opens on. */
  viewTab: ViewTab
  contactJump: ContactJump
}

export const LAYOUT_STORAGE_KEY = 'soda.layout'

/**
 * Sections folded on first run, which the user opens on demand. The imagery tab opens on its
 * list, with adding folded below it; the storage tool opens on its chart, with the image and
 * contact lists folded below it.
 */
export const DEFAULT_COLLAPSED: string[] = ['imagery.add', 'storage.images', 'storage.passes']

/** Reads a stored layout, dropping anything malformed rather than failing the app. */
export function parseLayout(raw: string | null): PanelLayout {
  const fallback = {
    collapsed: [...DEFAULT_COLLAPSED],
    timelinePinned: false,
    clockPinned: false,
    viewTab: 'layers' as ViewTab,
    contactJump: 'aos' as ContactJump,
  }
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const collapsed = Array.isArray(value.collapsed)
      ? value.collapsed.filter((id): id is string => typeof id === 'string').slice(0, 64)
      : fallback.collapsed
    return {
      collapsed,
      timelinePinned: value.timelinePinned === true,
      clockPinned: value.clockPinned === true,
      viewTab: isViewTab(value.viewTab) ? value.viewTab : fallback.viewTab,
      contactJump: value.contactJump === 'tca' ? 'tca' : 'aos',
    }
  } catch {
    return fallback
  }
}

/** Browser storage for the layout; smoke tests (`?e2e`) always start from the defaults. */
function layoutStorage(): Storage | null {
  try {
    return new URLSearchParams(location.search).has('e2e') ? null : localStorage
  } catch {
    return null
  }
}

function readStored(storage: Storage | null): string | null {
  try {
    return storage?.getItem(LAYOUT_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export const useUiStore = defineStore('ui', () => {
  const activeTool = ref<ToolId | null>('satellite')
  const helpOpen = ref(false)
  /** Globe projection; the view-control layer morphs the scene to match. */
  const sceneMode = ref<SceneMode>('3d')
  /** Bumped to ask the view-control layer to fly back to the home view. */
  const homeRequest = ref(0)
  /** Set when a reload restored the previous session, so the app can say so once. */
  const restoreNotice = ref<'discarded' | 'reload' | null>(null)
  /** The tool the left panel reopens with after it was folded away. */
  const lastTool = ref<ToolId>('satellite')
  /** Map scale at the middle of the view, written by the view-metrics layer; null off-globe. */
  const scaleBar = shallowRef<ScaleBar | null>(null)

  /**
   * `[west, south, east, north]` of what the globe shows, written by the view-metrics layer.
   * Null while part of the view looks past the globe, or the view crosses the antimeridian.
   */
  const viewBbox = shallowRef<readonly [number, number, number, number] | null>(null)

  function setViewBbox(next: readonly [number, number, number, number] | null) {
    const current = viewBbox.value
    if (current === next) return
    if (current && next && current.every((value, index) => Math.abs(value - next[index]!) < 1e-4))
      return
    viewBbox.value = next
  }

  function setScaleBar(next: ScaleBar | null) {
    const current = scaleBar.value
    if (current?.length_m === next?.length_m && current?.width_px === next?.width_px) return
    scaleBar.value = next
  }

  const storage = layoutStorage()
  const layout = parseLayout(readStored(storage))
  const collapsed = ref(new Set(layout.collapsed))
  const timelinePinned = ref(layout.timelinePinned)
  const clockPinned = ref(layout.clockPinned)
  const viewTab = ref<ViewTab>(layout.viewTab)
  const contactJump = ref<ContactJump>(layout.contactJump)
  /** Page the satellite tool shows: pick a satellite, set up the run, look at the runs. */
  const satelliteStep = ref<SatelliteStep>('pick')
  /** Tab the imaging tool shows; a finished search turns it to the results. */
  const imagingTab = ref<ImagingTab>('targets')
  /** Unpinned dock piece popped up over the dock while the pointer is on it or its icon. */
  const dockPeek = ref<DockPiece | null>(null)
  const peek = createHoverPeek<DockPiece>((piece) => (dockPeek.value = piece))
  // Pinning the piece in view puts it in the dock for good; unpinning drops it to its icon.
  watch([timelinePinned, clockPinned], () => peek.close())

  watch(
    [collapsed, timelinePinned, clockPinned, viewTab, contactJump],
    () => {
      try {
        const value: PanelLayout = {
          collapsed: [...collapsed.value],
          timelinePinned: timelinePinned.value,
          clockPinned: clockPinned.value,
          viewTab: viewTab.value,
          contactJump: contactJump.value,
        }
        storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(value))
      } catch {
        // Storage full or blocked: the layout just does not survive a reload.
      }
    },
    { deep: true },
  )

  function toggleTool(tool: ToolId) {
    activeTool.value = activeTool.value === tool ? null : tool
    if (activeTool.value) lastTool.value = activeTool.value
  }

  /** Opens a tool; `tab` also picks the view tool's tab. */
  function openTool(tool: ToolId, tab?: ViewTab) {
    activeTool.value = tool
    lastTool.value = tool
    if (tab) viewTab.value = tab
  }

  /** Folds the left panel away, or brings back the tool it last showed. */
  function toggleLeftPanel() {
    toggleTool(activeTool.value ?? lastTool.value)
  }

  function isCollapsed(id: string) {
    return collapsed.value.has(id)
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed.value)
    if (!next.delete(id)) next.add(id)
    collapsed.value = next
  }

  /** Unfold a section, for when something the user did belongs inside it. */
  function expand(id: string) {
    if (collapsed.value.has(id)) toggleCollapsed(id)
  }

  /** Opens the satellite tool on one of its pages. */
  function openSatelliteStep(step: SatelliteStep) {
    openTool('satellite')
    satelliteStep.value = step
  }

  /** Opens the imaging tool on one of its tabs. */
  function openImagingTab(tab: ImagingTab) {
    openTool('imaging')
    imagingTab.value = tab
  }

  function toggleSceneMode() {
    sceneMode.value = sceneMode.value === '3d' ? '2d' : '3d'
  }

  function goHome() {
    homeRequest.value++
  }

  return {
    activeTool,
    helpOpen,
    sceneMode,
    homeRequest,
    restoreNotice,
    scaleBar,
    setScaleBar,
    viewBbox,
    setViewBbox,
    timelinePinned,
    clockPinned,
    viewTab,
    contactJump,
    satelliteStep,
    imagingTab,
    dockPeek,
    peek,
    toggleTool,
    openTool,
    toggleLeftPanel,
    isCollapsed,
    toggleCollapsed,
    expand,
    openSatelliteStep,
    openImagingTab,
    toggleSceneMode,
    goHome,
  }
})
