import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { api } from '../api/client'
import type { Pass, PassesResponse, PassResult, Station, StationInput } from '../api/types'
import { MAX_SATELLITES, planWindows } from '../utils/passPlan'
import { useRunsStore, type OrbitRun } from './runs'
import { hasElements, refParams, satKey, type SatelliteRef } from '../utils/satelliteRef'

/** Keep in step with MAX_STATIONS in src/soda/orbit/passes.py and its API tests. */
export const MAX_STATIONS = 8

/** Stable key of one pass: ``<satellite index>:<station id>:<AOS>`` from the server. */
export function passKey(pass: Pick<Pass, 'id'>): string {
  return pass.id
}

export interface TimelineEntry {
  pass: Pass
  station: Station
  /** Station palette index. */
  colorIndex: number
  /** Priority index of the satellite, as in `Pass.satellite_index`. */
  satelliteIndex: number
}

export const usePassesStore = defineStore('passes', () => {
  const runs = useRunsStore()
  const stations = ref<Station[]>([])
  const selectedIds = ref<number[]>([])
  const result = shallowRef<PassesResponse | null>(null)
  const loading = ref(false)
  const error = ref<unknown>(null)
  /** Span the current result covers: every satellite's window together (UTC epoch ms). */
  const windowMs = ref({ start: 0, end: 0 })
  /** Run of each satellite in the result, by priority index. */
  const resultRunIds = ref<string[]>([])
  /** Satellite of each one, by `satKey`: a run propagated again keeps its place. */
  const resultSatKeys = ref<string[]>([])
  /** Stations and turnaround the result was requested with, to tell when it is stale. */
  const resultSetup = ref('')
  /** Run ids the user moved up or down; the rest follow in propagation order. */
  const priority = ref<string[]>([])
  /** Antenna turnaround between two passes at one station, in seconds. */
  const turnaroundS = ref(60)

  /** Carrier the pass detail reads its Doppler shift at, in MHz. Not saved. */
  const carrierMhz = ref(2200)

  /** Whether the pass timeline dock above the clock bar is showing. */
  const timelineOpen = ref(false)
  /** Contacts the user switched off; everything else is drawn on the globe. */
  const hidden = ref(new Set<string>())

  // Every known station gets a colour as soon as it is loaded, and keeps it: deselecting
  // one must not recolour the rest, and two stations must never look alike in the list.
  // Only the palette index lives here; the colours come from the theme preset.
  const colorIndex = ref(new Map<number, number>())
  let colorCounter = 0

  const selected = computed(() =>
    selectedIds.value
      .map((id) => stations.value.find((station) => station.id === id))
      .filter((station): station is Station => station !== undefined),
  )
  const station = computed(() => selected.value[0] ?? null)
  const full = computed(() => selectedIds.value.length >= MAX_STATIONS)

  function colorIndexOf(id: number): number {
    return colorIndex.value.get(id) ?? 0
  }

  function remember(id: number) {
    if (!colorIndex.value.has(id)) colorIndex.value.set(id, colorCounter++)
  }

  function isSelected(id: number) {
    return selectedIds.value.includes(id)
  }

  function toggleStation(id: number) {
    const at = selectedIds.value.indexOf(id)
    if (at >= 0) {
      selectedIds.value = selectedIds.value.filter((value) => value !== id)
      return
    }
    if (full.value) return
    remember(id)
    selectedIds.value = [...selectedIds.value, id]
  }

  function selectOnly(ids: number[]) {
    const kept = ids.slice(0, MAX_STATIONS)
    kept.forEach(remember)
    selectedIds.value = kept
  }

  /** More than one satellite: passes are told apart by satellite, not only by station. */
  const multi = computed(() => (result.value?.satellites.length ?? 0) > 1)

  /** The station results of the focused satellite: its visibility areas and summary. */
  const results = computed<PassResult[]>(() => {
    const satellites = result.value?.satellites ?? []
    // The selected run's satellite, else the highest priority one.
    const index = Math.max(0, runs.selectedRun ? indexOfSatellite(runs.selectedRun) : -1)
    return satellites[index]?.results ?? []
  })

  /** Priority index of the satellite in the result, or -1 when it was not part of it. */
  function indexOfSatellite(ref: SatelliteRef): number {
    return resultSatKeys.value.indexOf(satKey(ref))
  }

  /** Every satellite's passes over every station on one timeline, earliest first. */
  const timeline = computed<TimelineEntry[]>(() => {
    const entries = (result.value?.satellites ?? []).flatMap((satellite) =>
      satellite.results.flatMap((item) =>
        item.passes.map((pass) => ({
          pass,
          station: item.station,
          colorIndex: colorIndexOf(item.station.id),
          satelliteIndex: satellite.index,
        })),
      ),
    )
    return entries.sort((a, b) => Date.parse(a.pass.aos) - Date.parse(b.pass.aos))
  })

  function satelliteName(index: number): string {
    return result.value?.satellites[index]?.element_set.name ?? ''
  }

  /**
   * Runs in priority order: moved ones first as placed, then propagation order. Runs without
   * mean elements (state vectors) are left out, since passes are computed with SGP4.
   */
  function ordered(runs: readonly OrbitRun[]): OrbitRun[] {
    const rank = (run: OrbitRun) => {
      const at = priority.value.indexOf(run.id)
      return at < 0 ? priority.value.length + runs.indexOf(run) : at
    }
    return runs.filter(hasElements).sort((a, b) => rank(a) - rank(b))
  }

  function move(runs: readonly OrbitRun[], id: string, step: -1 | 1) {
    const ids = ordered(runs).map((run) => run.id)
    const at = ids.indexOf(id)
    const to = at + step
    if (at < 0 || to < 0 || to >= ids.length) return
    ;[ids[at], ids[to]] = [ids[to]!, ids[at]!]
    priority.value = ids
  }

  /** Setup a result would be requested with now; differs from `resultSetup` when stale. */
  function setupKey(runs: readonly OrbitRun[]): string {
    const planned = ordered(runs).slice(0, MAX_SATELLITES)
    return JSON.stringify([planned.map((run) => run.id), selectedIds.value, turnaroundS.value])
  }

  /** Chronological number of each contact across every station, from 1. */
  const passNumbers = computed(
    () => new Map(timeline.value.map((entry, index) => [passKey(entry.pass), index + 1])),
  )

  function numberOf(key: string): number {
    return passNumbers.value.get(key) ?? 0
  }

  /** Whether any of this station's contacts is still switched on. */
  function stationHasShownPass(stationId: number): boolean {
    const passes = resultFor(stationId)?.passes ?? []
    return passes.some((pass) => !hidden.value.has(passKey(pass)))
  }

  function isPassVisible(key: string) {
    return !hidden.value.has(key)
  }

  function togglePass(key: string) {
    const next = new Set(hidden.value)
    if (!next.delete(key)) next.add(key)
    hidden.value = next
  }

  function setAllPassesVisible(visible: boolean) {
    hidden.value = visible ? new Set() : new Set(timeline.value.map((entry) => passKey(entry.pass)))
  }

  const resultFor = (id: number) => results.value.find((item) => item.station.id === id) ?? null

  async function loadStations() {
    try {
      stations.value = await api.stations()
      stations.value.forEach((station) => remember(station.id))
      const alive = selectedIds.value.filter((id) =>
        stations.value.some((station) => station.id === id),
      )
      selectOnly(alive.length ? alive : stations.value.slice(0, 1).map((station) => station.id))
    } catch (caught) {
      error.value = caught
    }
  }

  async function addStation(input: StationInput) {
    const created = await api.createStation(input)
    await loadStations()
    selectOnly([...selectedIds.value.filter((id) => id !== created.id), created.id])
  }

  async function saveStation(id: number, input: StationInput) {
    await api.updateStation(id, input)
    await loadStations()
  }

  async function removeStation(id: number) {
    await api.deleteStation(id)
    selectedIds.value = selectedIds.value.filter((value) => value !== id)
    if (results.value.some((item) => item.station.id === id)) {
      result.value = null
      timelineOpen.value = false
    }
    await loadStations()
  }

  /**
   * Passes of every run (up to eight, in priority order) over the selected stations, each
   * within its own propagated window. A station serves one satellite at a time, so the
   * server marks overlapping passes and gives them to the higher priority.
   */
  async function predict(runs: readonly OrbitRun[]) {
    const planned = ordered(runs).slice(0, MAX_SATELLITES)
    if (!selectedIds.value.length || !planned.length) return
    loading.value = true
    error.value = null
    const windows = planWindows(planned)
    try {
      const response = await api.passes({
        satellites: planned.map((run, i) => ({
          ...refParams(run),
          start: new Date(windows[i]!.startMs).toISOString(),
          end: new Date(windows[i]!.endMs).toISOString(),
        })),
        station_ids: [...selectedIds.value],
        turnaround_s: turnaroundS.value,
      })
      result.value = markRaw(response)
      resultRunIds.value = planned.map((run) => run.id)
      resultSatKeys.value = planned.map(satKey)
      resultSetup.value = setupKey(runs)
      windowMs.value = {
        start: Math.min(...windows.map((w) => w.startMs)),
        end: Math.max(...windows.map((w) => w.endMs)),
      }
      hidden.value = new Set()
      timelineOpen.value = true
    } catch (caught) {
      error.value = caught
    } finally {
      loading.value = false
    }
  }

  return {
    stations,
    selectedIds,
    selected,
    station,
    full,
    result,
    results,
    multi,
    windowMs,
    resultRunIds,
    resultSatKeys,
    indexOfSatellite,
    resultSetup,
    priority,
    turnaroundS,
    carrierMhz,
    timeline,
    satelliteName,
    ordered,
    move,
    setupKey,
    hidden,
    timelineOpen,
    isPassVisible,
    numberOf,
    stationHasShownPass,
    togglePass,
    setAllPassesVisible,
    loading,
    error,
    colorIndexOf,
    isSelected,
    toggleStation,
    selectOnly,
    resultFor,
    loadStations,
    addStation,
    saveStation,
    removeStation,
    predict,
  }
})
