import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowRef, watch } from 'vue'
import { api } from '../api/client'
import {
  boxFromCorners,
  MAX_ACCESS_DAYS,
  MAX_TARGET_NAME,
  MAX_TARGETS,
  sanitizeTarget,
  toRequest,
  type ImagingTarget,
} from '../mission/targets'
import {
  defaultStorageSettings,
  sanitizeStorageSettings,
  type StorageSettings,
} from '../mission/storage'
import { defaultPowerSettings, sanitizePowerSettings, type PowerSettings } from '../mission/power'
import {
  defaultCoverageSettings,
  sanitizeCoverageSettings,
  type CoverageSettings,
} from '../mission/coverage'
import { flattenShots, type AccessRun, type SatelliteAccess, type Shot } from '../mission/shots'
import { MAX_SATELLITES } from '../utils/passPlan'
import { runPool } from '../utils/pool'
import { persistenceSuspended } from '../utils/resetClientState'
import { hasElements, refParams, satKey, type SatelliteRef } from '../utils/satelliteRef'
import { useRunsStore } from './runs'

export type { AccessRun } from '../mission/shots'

export const MISSION_STORAGE_KEY = 'soda.mission'
const DAY_MS = 86_400_000
/** Imaging searches sent at once; each is one satellite over its own run. */
const CONCURRENCY = 3

/** What a globe click does while the imaging tab is waiting for one. */
export type PlacingMode = 'point' | 'box'

/**
 * `roll`: the sensor only rolls, so a target is imaged as the cross-track plane passes
 * over it. `roll_pitch`: it can also pitch ahead and behind within `maxPitchDeg`.
 */
export type PointingMode = 'roll' | 'roll_pitch'

export interface MissionSettings {
  targets: ImagingTarget[]
  pointingMode: PointingMode
  maxRollDeg: number
  maxPitchDeg: number
  /** Cross-track field of view; half of it widens the roll reach. */
  fovDeg: number
  minSunElevDeg: number
  storage: StorageSettings
  power: PowerSettings
  coverage: CoverageSettings
}

/** A satellite whose imaging search failed while others went through. */
export interface AccessFailure {
  run: AccessRun
  error: unknown
}

function defaults(): MissionSettings {
  return {
    targets: [],
    pointingMode: 'roll',
    maxRollDeg: 30,
    maxPitchDeg: 30,
    fovDeg: 0,
    minSunElevDeg: 10,
    storage: defaultStorageSettings(),
    power: defaultPowerSettings(),
    coverage: defaultCoverageSettings(),
  }
}

const inRange = (value: unknown, lo: number, hi: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi

/** Repair whatever was stored; bad targets are dropped, bad numbers fall back. */
export function sanitizeMission(value: unknown): MissionSettings {
  const fallback = defaults()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  const seen = new Set<string>()
  const targets = (Array.isArray(raw.targets) ? raw.targets : [])
    .map(sanitizeTarget)
    .filter((t): t is ImagingTarget => !!t && !seen.has(t.id) && !!seen.add(t.id))
    .slice(0, MAX_TARGETS)
  return {
    targets,
    pointingMode: raw.pointingMode === 'roll_pitch' ? 'roll_pitch' : 'roll',
    // Settings saved before roll and pitch were split kept a single off-nadir limit.
    maxRollDeg: inRange(raw.maxRollDeg, 1, 88)
      ? raw.maxRollDeg
      : inRange(raw.maxOffNadirDeg, 1, 88)
        ? raw.maxOffNadirDeg
        : 30,
    maxPitchDeg: inRange(raw.maxPitchDeg, 0, 88) ? raw.maxPitchDeg : 30,
    fovDeg: inRange(raw.fovDeg, 0, 178) ? raw.fovDeg : 0,
    minSunElevDeg: inRange(raw.minSunElevDeg, -90, 90) ? raw.minSunElevDeg : 10,
    storage: sanitizeStorageSettings(raw.storage),
    power: sanitizePowerSettings(raw.power),
    coverage: sanitizeCoverageSettings(raw.coverage),
  }
}

/** Browser storage, or null in smoke tests (`?e2e`), which start from a clean state. */
function missionStorage(): Storage | null {
  try {
    return new URLSearchParams(location.search).has('e2e') ? null : localStorage
  } catch {
    return null
  }
}

function load(storage: Storage | null): MissionSettings {
  try {
    return sanitizeMission(JSON.parse(storage?.getItem(MISSION_STORAGE_KEY) ?? 'null'))
  } catch {
    return defaults()
  }
}

let sequence = 0
const newId = () => `aoi-${Date.now().toString(36)}-${(sequence++).toString(36)}`

export const useMissionStore = defineStore('mission', () => {
  const storage = missionStorage()
  const runs = useRunsStore()
  const saved = reactive(load(storage))
  const placing = ref<PlacingMode | null>(null)
  /** First corner of a box being clicked out. */
  const corner = ref<{ lon_deg: number; lat_deg: number } | null>(null)
  /** The imaging result of each satellite, in the order they were searched. */
  const results = shallowRef<SatelliteAccess[]>([])
  /** Satellites of the last search that failed. */
  const failures = shallowRef<AccessFailure[]>([])
  /** Satellites answered so far while a search runs. */
  const progress = ref<{ done: number; total: number } | null>(null)
  /** Runs, targets and pointing the results were requested with, to tell when they are stale. */
  const resultSetup = ref('')
  /** Pointing settings as they are now, and as the result was computed with. */
  const pointingKey = computed(() =>
    JSON.stringify([
      saved.pointingMode,
      saved.maxRollDeg,
      saved.maxPitchDeg,
      saved.fovDeg,
      saved.minSunElevDeg,
      // The strips drawn on the globe are as long as one acquisition.
      saved.storage.shotS,
    ]),
  )
  /** The pointing limits are numbers the server accepts. */
  const pointingValid = computed(() => {
    const within = (value: number, lo: number, hi: number) =>
      Number.isFinite(value) && value >= lo && value <= hi
    return (
      within(saved.maxRollDeg, 0.001, 88.999) &&
      within(saved.maxPitchDeg, 0, 88.999) &&
      within(saved.fovDeg, 0, 178.999) &&
      within(saved.minSunElevDeg, -90, 90)
    )
  })
  const resultPointing = shallowRef<{ key: string; mode: PointingMode } | null>(null)
  /** Imaging windows of the result that are not taken, by shot key. */
  const excludedShots = ref(new Set<string>())
  const loading = ref(false)
  const error = ref<unknown>(null)
  const focusedTargetId = ref<string | null>(null)
  let controller: AbortController | null = null

  watch(
    saved,
    () => {
      if (!storage || persistenceSuspended()) return
      try {
        storage.setItem(MISSION_STORAGE_KEY, JSON.stringify(saved))
      } catch {
        // Storage full or blocked: targets just do not survive a reload.
      }
    },
    { deep: true },
  )

  /**
   * Runs an imaging search covers: every run with mean elements, up to eight. The search
   * is SGP4, so a state vector or an ephemeris cannot be searched.
   */
  const planned = computed<AccessRun[]>(() =>
    runs.runs
      .filter(hasElements)
      .slice(0, MAX_SATELLITES)
      .map(({ id, name, noradId, customId, kind, startMs, stopMs, colorIndex }) => ({
        id,
        name,
        noradId,
        customId,
        ...(kind ? { kind } : {}),
        startMs,
        stopMs,
        colorIndex,
      })),
  )
  /** Setup a search would be requested with now; differs from `resultSetup` when stale. */
  const setupKey = computed(() =>
    JSON.stringify([
      planned.value.map((run) => run.id),
      saved.targets.map((target) => target.id),
      pointingKey.value,
    ]),
  )
  const stale = computed(() => resultSetup.value !== setupKey.value)

  /** Every window of every satellite still propagated, in time order. */
  const shots = computed<Shot[]>(() =>
    flattenShots(results.value, saved.targets, new Set(runs.runs.map(satKey))),
  )
  const shotIndex = computed(() => new Map(shots.value.map((shot) => [shot.key, shot])))
  /** More than one satellite: windows are told apart by satellite colour. */
  const multi = computed(() => results.value.length > 1)

  function nextName(prefix: string) {
    const taken = new Set(saved.targets.map((t) => t.name))
    for (let n = saved.targets.length + 1; ; n++) {
      const name = `${prefix}${n}`
      if (!taken.has(name)) return name
    }
  }

  /** Add a point target; returns its id, or null when the list is full. */
  function addPoint(lat_deg: number, lon_deg: number, name?: string): string | null {
    if (saved.targets.length >= MAX_TARGETS) return null
    const clean = name?.trim().slice(0, MAX_TARGET_NAME) || nextName('P')
    const id = newId()
    saved.targets.push({ kind: 'point', id, name: clean, lat_deg, lon_deg })
    return id
  }

  /** Add an area target; returns its id, or null when the list is full or the box is empty. */
  function addBox(
    box: { west_deg: number; south_deg: number; east_deg: number; north_deg: number },
    name?: string,
  ): string | null {
    if (saved.targets.length >= MAX_TARGETS || box.south_deg >= box.north_deg) return null
    const clean = name?.trim().slice(0, MAX_TARGET_NAME) || nextName('A')
    const id = newId()
    saved.targets.push({ kind: 'box', id, name: clean, ...box })
    return id
  }

  function removeTarget(id: string) {
    saved.targets = saved.targets.filter((t) => t.id !== id)
    if (focusedTargetId.value === id) focusedTargetId.value = null
  }

  function renameTarget(id: string, name: string) {
    const target = saved.targets.find((t) => t.id === id)
    const clean = name.trim().slice(0, MAX_TARGET_NAME)
    if (target && clean) target.name = clean
  }

  function setPlacing(mode: PlacingMode | null) {
    placing.value = mode
    corner.value = null
  }

  /** A globe click while placing: a point target, or one corner of a box. */
  function receiveClick(lon_deg: number, lat_deg: number) {
    if (placing.value === 'point') {
      addPoint(lat_deg, lon_deg)
      setPlacing(null)
    } else if (placing.value === 'box') {
      if (!corner.value) {
        corner.value = { lon_deg, lat_deg }
        return
      }
      const box = boxFromCorners(corner.value, { lon_deg, lat_deg })
      if (box.south_deg < box.north_deg) addBox(box)
      setPlacing(null)
    }
  }

  /**
   * Imaging opportunities of every planned run, each within its own propagated window. The
   * server searches one satellite per request, so they go out a few at a time; a satellite
   * that fails is reported and the rest still count.
   */
  async function compute() {
    const targets = saved.targets.map(toRequest)
    const list = planned.value
    if (!targets.length || !list.length) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    loading.value = true
    error.value = null
    progress.value = { done: 0, total: list.length }
    const asked = { key: pointingKey.value, mode: saved.pointingMode }
    const setup = setupKey.value
    const body = {
      targets,
      mode: saved.pointingMode,
      max_roll_deg: saved.maxRollDeg,
      max_pitch_deg: saved.maxPitchDeg,
      fov_deg: saved.fovDeg,
      min_sun_elev_deg: saved.minSunElevDeg,
      shot_s: saved.storage.shotS,
    }
    const made: (SatelliteAccess | null)[] = list.map(() => null)
    const failed: AccessFailure[] = []
    let answered = 0
    async function search(run: AccessRun, index: number) {
      const endMs = Math.min(run.stopMs, run.startMs + MAX_ACCESS_DAYS * DAY_MS)
      try {
        const response = await api.access(
          {
            ...refParams(run),
            ...body,
            start: new Date(run.startMs).toISOString(),
            end: new Date(endMs).toISOString(),
          },
          own.signal,
        )
        made[index] = { key: satKey(run), run: { ...run, stopMs: endMs }, response }
      } catch (caught) {
        if (!own.signal.aborted) failed.push({ run, error: caught })
      }
      answered += 1
      if (controller === own) progress.value = { done: answered, total: list.length }
    }
    try {
      await runPool(list, CONCURRENCY, own.signal, search)
      if (own.signal.aborted) return
      const done = made.filter((item): item is SatelliteAccess => item !== null)
      if (!done.length) {
        // Nothing came back: what is on screen stays, with the reason it was not replaced.
        error.value = failed[0]?.error ?? null
        return
      }
      results.value = markRaw(done)
      failures.value = failed
      resultSetup.value = setup
      resultPointing.value = asked
      excludedShots.value = new Set()
    } finally {
      if (controller === own) {
        loading.value = false
        progress.value = null
        controller = null
      }
    }
  }

  function clearResult() {
    controller?.abort()
    results.value = []
    failures.value = []
    resultSetup.value = ''
    resultPointing.value = null
    excludedShots.value = new Set()
    error.value = null
  }

  /**
   * The imaging result of a satellite, or null when none was computed for it. Matched by
   * satellite, so it is still found after the run is propagated again.
   */
  function resultOf(ref: SatelliteRef): SatelliteAccess | null {
    const key = satKey(ref)
    return results.value.find((item) => item.key === key) ?? null
  }

  function toggleShot(key: string) {
    const next = new Set(excludedShots.value)
    if (!next.delete(key)) next.add(key)
    excludedShots.value = next
  }

  return {
    saved,
    placing,
    corner,
    results,
    failures,
    progress,
    planned,
    stale,
    shots,
    shotIndex,
    multi,
    pointingKey,
    pointingValid,
    resultPointing,
    excludedShots,
    loading,
    error,
    focusedTargetId,
    addPoint,
    addBox,
    removeTarget,
    renameTarget,
    setPlacing,
    receiveClick,
    compute,
    clearResult,
    resultOf,
    toggleShot,
  }
})
