import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { api } from '../api/client'
import type { ApiMessage } from '../api/types'
import {
  cellAt,
  cellMetrics,
  commonWindow,
  gridShape,
  mergeEvents,
  RESOLUTIONS,
  summarize,
  valueRange,
  type Grid,
  type SatelliteEvents,
} from '../mission/coverage'
import type { AccessRun } from '../mission/shots'
import { MAX_ACCESS_DAYS, type BoxTarget } from '../mission/targets'
import { runPool } from '../utils/pool'
import { refParams, satKey } from '../utils/satelliteRef'
import { useMissionStore } from './mission'
import { useUiStore } from './ui'

const DAY_MS = 86_400_000
/** Coverage searches sent at once; each is one satellite over its own run. */
const CONCURRENCY = 3

/** One satellite's events, with the run they were searched over. */
export interface SatelliteCoverage extends SatelliteEvents {
  run: AccessRun
  warnings: ApiMessage[]
}

export interface CoverageResult {
  grid: Grid
  targetId: string
  satellites: SatelliteCoverage[]
}

/** A satellite whose coverage search failed while others went through. */
export interface CoverageFailure {
  run: AccessRun
  error: unknown
}

/**
 * Coverage of one box target by every planned run. The result is not saved: it is as large
 * as the grid times the passes, and a reload can ask for it again.
 */
export const useCoverageStore = defineStore('coverage', () => {
  const mission = useMissionStore()
  const ui = useUiStore()
  const settings = mission.saved.coverage
  const result = shallowRef<CoverageResult | null>(null)
  const failures = shallowRef<CoverageFailure[]>([])
  const progress = ref<{ done: number; total: number } | null>(null)
  const loading = ref(false)
  const error = ref<unknown>(null)
  /** Setup the result was requested with, to tell when it is stale. */
  const resultSetup = ref('')
  /** `satKey` of the one satellite looked at; null takes them all together. */
  const satelliteFilter = ref<string | null>(null)
  const selectedCell = ref<number | null>(null)
  let controller: AbortController | null = null

  const boxes = computed(() =>
    mission.saved.targets.filter((target): target is BoxTarget => target.kind === 'box'),
  )
  /** The box covered: the chosen one while it exists, else the first. */
  const target = computed(
    () => boxes.value.find((box) => box.id === settings.targetId) ?? boxes.value[0] ?? null,
  )

  const setupKey = computed(() => {
    const box = target.value
    return JSON.stringify([
      mission.planned.map((run) => run.id),
      box && [box.id, box.west_deg, box.south_deg, box.east_deg, box.north_deg],
      settings.resolution,
      mission.saved.pointingMode,
      mission.saved.maxRollDeg,
      mission.saved.maxPitchDeg,
      mission.saved.fovDeg,
      mission.saved.minSunElevDeg,
    ])
  })
  const stale = computed(() => result.value !== null && resultSetup.value !== setupKey.value)
  /** The map is on the globe: the coverage tool is open and there is something to paint. */
  const shown = computed(() => ui.activeTool === 'coverage' && result.value !== null)

  /** The satellites the numbers are taken over. */
  const included = computed(() => {
    const all = result.value?.satellites ?? []
    const one = all.filter((item) => item.key === satelliteFilter.value)
    return one.length ? one : all
  })
  /** The span every included satellite was searched over; null when they share none. */
  const window = computed(() => commonWindow(included.value))
  const events = computed(() => {
    const grid = result.value?.grid
    return grid && window.value
      ? mergeEvents(included.value, grid.nx * grid.ny, window.value)
      : null
  })
  const values = computed(() =>
    events.value && window.value ? cellMetrics(events.value, window.value) : null,
  )
  const summary = computed(() =>
    values.value && result.value ? summarize(values.value, result.value.grid) : null,
  )
  /** Lowest and highest of the painted metric among the imaged cells. */
  const range = computed(() =>
    values.value ? valueRange(values.value[settings.metric], values.value.count) : null,
  )

  async function compute() {
    const box = target.value
    const list = mission.planned
    if (!box || !list.length) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    loading.value = true
    error.value = null
    progress.value = { done: 0, total: list.length }
    const setup = setupKey.value
    const { west_deg, south_deg, east_deg, north_deg } = box
    const grid: Grid = {
      west_deg,
      south_deg,
      east_deg,
      north_deg,
      ...gridShape(box, RESOLUTIONS[settings.resolution]),
    }
    const body = {
      ...grid,
      mode: mission.saved.pointingMode,
      max_roll_deg: mission.saved.maxRollDeg,
      max_pitch_deg: mission.saved.maxPitchDeg,
      fov_deg: mission.saved.fovDeg,
      min_sun_elev_deg: mission.saved.minSunElevDeg,
    }
    const made: (SatelliteCoverage | null)[] = list.map(() => null)
    const failed: CoverageFailure[] = []
    let answered = 0
    async function search(run: AccessRun, index: number) {
      const endMs = Math.min(run.stopMs, run.startMs + MAX_ACCESS_DAYS * DAY_MS)
      try {
        const response = await api.coverage(
          {
            ...refParams(run),
            ...body,
            start: new Date(run.startMs).toISOString(),
            end: new Date(endMs).toISOString(),
          },
          own.signal,
        )
        made[index] = {
          key: satKey(run),
          run: { ...run, stopMs: endMs },
          startMs: run.startMs,
          endMs,
          counts: response.counts,
          offsetS: response.offset_s,
          warnings: response.warnings,
        }
      } catch (caught) {
        if (!own.signal.aborted) failed.push({ run, error: caught })
      }
      answered += 1
      if (controller === own) progress.value = { done: answered, total: list.length }
    }
    try {
      await runPool(list, CONCURRENCY, own.signal, search)
      if (own.signal.aborted) return
      const done = made.filter((item): item is SatelliteCoverage => item !== null)
      if (!done.length) {
        // Nothing came back: what is on the globe stays, with the reason it was not replaced.
        error.value = failed[0]?.error ?? null
        return
      }
      result.value = markRaw({ grid, targetId: box.id, satellites: done })
      failures.value = failed
      resultSetup.value = setup
      satelliteFilter.value = null
      selectedCell.value = null
    } finally {
      if (controller === own) {
        loading.value = false
        progress.value = null
        controller = null
      }
    }
  }

  function clear() {
    controller?.abort()
    result.value = null
    failures.value = []
    resultSetup.value = ''
    satelliteFilter.value = null
    selectedCell.value = null
    error.value = null
  }

  /** Select the cell under a globe click; false when the click missed the grid. */
  function selectAt(lon_deg: number, lat_deg: number): boolean {
    const grid = shown.value ? result.value?.grid : null
    const cell = grid ? cellAt(grid, lon_deg, lat_deg) : null
    if (cell === null) return false
    selectedCell.value = cell
    return true
  }

  return {
    settings,
    result,
    failures,
    progress,
    loading,
    error,
    boxes,
    target,
    stale,
    shown,
    satelliteFilter,
    selectedCell,
    included,
    window,
    events,
    values,
    summary,
    range,
    compute,
    clear,
    selectAt,
  }
})
