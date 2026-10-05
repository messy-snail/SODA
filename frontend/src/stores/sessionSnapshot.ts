import { parseSatKey } from '../utils/satelliteRef'
import { MAX_BASKET } from './basketItems'
import { isViewTab, tools, type SceneMode, type ToolId, type ViewTab } from './ui'

/**
 * Working state kept in `sessionStorage`, so a reload of the tab - including the browser
 * discarding a heavy background tab to save memory and reloading it on return - brings the
 * reader back to where they were. Propagation runs are stored separately (runsPersistence).
 */
export const SESSION_STORAGE_KEY = 'soda.session.v1'

export interface CameraSnapshot {
  lon_deg: number
  lat_deg: number
  height_m: number
  heading_rad: number
  pitch_rad: number
  roll_rad: number
}

export interface SessionSnapshot {
  camera: CameraSnapshot | null
  sceneMode: SceneMode
  clock: { currentMs: number; playing: boolean; multiplier: number } | null
  activeTool: ToolId | null
  /** Tab of the view tool; null keeps whatever the layout remembered. */
  viewTab: ViewTab | null
  /** Satellites picked for propagation, as `satKey`s. */
  basket: string[]
  stationIds: number[]
  swathToggles: Record<string, boolean>
  comparison: boolean
  trackedRunId: string | null
  savedAtMs: number
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function cameraOf(value: unknown): CameraSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const keys = ['lon_deg', 'lat_deg', 'height_m', 'heading_rad', 'pitch_rad', 'roll_rad']
  if (!keys.every((key) => finite(raw[key]))) return null
  if (Math.abs(raw.lat_deg as number) > 90 || (raw.height_m as number) <= 0) return null
  return Object.fromEntries(keys.map((key) => [key, raw[key]])) as unknown as CameraSnapshot
}

function clockOf(value: unknown): SessionSnapshot['clock'] {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!finite(raw.currentMs) || !finite(raw.multiplier) || raw.multiplier === 0) return null
  return { currentMs: raw.currentMs, playing: raw.playing === true, multiplier: raw.multiplier }
}

const positiveInt = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value > 0

/** The picked satellites; older snapshots held one catalog or saved satellite instead. */
function basketKeys(raw: Record<string, unknown>): string[] {
  if (Array.isArray(raw.basket)) {
    const keys = raw.basket.filter((key): key is string => typeof key === 'string')
    return keys.filter((key) => parseSatKey(key) !== null).slice(0, MAX_BASKET)
  }
  if (positiveInt(raw.selectedCustom)) return [`custom:${raw.selectedCustom}`]
  if (positiveInt(raw.selectedNorad)) return [`norad:${raw.selectedNorad}`]
  return []
}

/** Rail tools that became tabs of the view tool; older snapshots still name them. */
const LEGACY_VIEW_TOOLS: Record<string, ViewTab> = {
  layers: 'layers',
  places: 'places',
  markers: 'markers',
}

/** Rail tools folded into another tool; older snapshots still name them. */
const MERGED_TOOLS = new Map<string, ToolId>([
  ['propagate', 'satellite'],
  // The mission tool's tabs became their own tools; imaging was its first tab.
  ['mission', 'imaging'],
])

/** Read a stored snapshot, dropping every field that does not check out. */
export function sanitizeSnapshot(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const toolIds = tools.map((tool) => tool.id) as unknown[]
  const toggles =
    raw.swathToggles && typeof raw.swathToggles === 'object'
      ? Object.fromEntries(
          Object.entries(raw.swathToggles as Record<string, unknown>).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
          ),
        )
      : {}
  const legacyTab =
    typeof raw.activeTool === 'string' && Object.hasOwn(LEGACY_VIEW_TOOLS, raw.activeTool)
      ? LEGACY_VIEW_TOOLS[raw.activeTool]
      : undefined
  return {
    camera: cameraOf(raw.camera),
    sceneMode: raw.sceneMode === '2d' ? '2d' : '3d',
    clock: clockOf(raw.clock),
    activeTool: legacyTab
      ? 'view'
      : toolIds.includes(raw.activeTool)
        ? (raw.activeTool as ToolId)
        : typeof raw.activeTool === 'string'
          ? (MERGED_TOOLS.get(raw.activeTool) ?? null)
          : null,
    viewTab: legacyTab ?? (isViewTab(raw.viewTab) ? raw.viewTab : null),
    basket: basketKeys(raw),
    stationIds: Array.isArray(raw.stationIds)
      ? raw.stationIds.filter((id): id is number => Number.isInteger(id))
      : [],
    swathToggles: toggles,
    comparison: raw.comparison !== false,
    trackedRunId: typeof raw.trackedRunId === 'string' ? raw.trackedRunId : null,
    savedAtMs: finite(raw.savedAtMs) ? raw.savedAtMs : 0,
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function loadSnapshot(storage: StorageLike | null): SessionSnapshot | null {
  if (!storage) return null
  try {
    return sanitizeSnapshot(JSON.parse(storage.getItem(SESSION_STORAGE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

/** Write the snapshot; returns the serialised text so callers can skip unchanged writes. */
export function saveSnapshot(storage: StorageLike | null, snapshot: SessionSnapshot): void {
  if (!storage) return
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* Quota or privacy mode: the session just is not restorable. */
  }
}

/** Session storage for the snapshot; browser tests opt in with `?e2e&keep`. */
export function snapshotStorage(): Storage | null {
  try {
    const params = new URLSearchParams(location.search)
    return params.has('e2e') && !params.has('keep') ? null : sessionStorage
  } catch {
    return null
  }
}

/** Why the page was loaded: the browser discarded the tab, the reader reloaded, or neither. */
export function reloadReason(): 'discarded' | 'reload' | null {
  try {
    if ((document as Document & { wasDiscarded?: boolean }).wasDiscarded) return 'discarded'
    const entry = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined
    return entry?.type === 'reload' ? 'reload' : null
  } catch {
    return null
  }
}
