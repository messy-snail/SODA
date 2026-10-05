import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { PropagateResponse } from '../api/types'
import type { HpopOptions, Propagator } from '../orbit/propagatorOptions'
import { refParams, sameSatellite, type SatelliteRef } from '../utils/satelliteRef'
import { persistenceSuspended } from '../utils/resetClientState'
import { useClockStore } from './clock'
import { lastSequence, loadRuns, saveRuns } from './runsPersistence'

export interface OrbitRun extends SatelliteRef {
  id: string
  name: string
  colorIndex: number
  visible: boolean
  startMs: number
  stopMs: number
  /** What produced the run; `/swath` asks for the same so both use one trajectory. */
  propagator: Propagator
  /** HPOP options the run was requested with; null for the other propagators. */
  hpop: HpopOptions | null
  data: PropagateResponse
}

export interface PropagationInput extends SatelliteRef {
  /** Shown against a failure; the run itself takes the name the server returns. */
  name?: string
  startMs: number
  endMs: number
  stepS: number
  /** Left out, the server picks the default for the satellite's kind of source. */
  propagator?: Propagator
  hpop?: HpopOptions | null
}

let sequence = 0

/** Session storage for runs, or null in browser tests unless they opt in with `?e2e&keep`. */
function runStorage(): Storage | null {
  try {
    const params = new URLSearchParams(location.search)
    return params.has('e2e') && !params.has('keep') ? null : sessionStorage
  } catch {
    return null
  }
}

export function sampleTimeMs(run: OrbitRun, index: number): number {
  return run.startMs + index * run.data.step_s * 1000
}

export const useRunsStore = defineStore('runs', () => {
  const storage = runStorage()
  const restored = storage ? loadRuns(storage) : { runs: [], selectedRunId: null }
  sequence = Math.max(sequence, lastSequence(restored.runs))
  const runs = shallowRef<OrbitRun[]>(
    restored.runs.map((run) => ({ ...run, data: markRaw(run.data) })),
  )
  const selectedRunId = ref<string | null>(restored.selectedRunId)
  const hoveredRunId = ref<string | null>(null)
  /** Run whose marker the camera follows; the globe mirrors Cesium's tracked entity here. */
  const trackedRunId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** Satellites the last batch could not propagate, with the reason for each. */
  const failures = ref<{ name: string; message: string }[]>([])
  /** How far the batch in flight has got, or null when none is. */
  const progress = ref<{ done: number; total: number } | null>(null)
  let colorCounter = runs.value.reduce((next, run) => Math.max(next, run.colorIndex + 1), 0)

  const selectedRun = computed(
    () => runs.value.find((run) => run.id === selectedRunId.value) ?? null,
  )

  function update(id: string, patch: Partial<OrbitRun>) {
    runs.value = runs.value.map((run) => (run.id === id ? { ...run, ...patch } : run))
  }

  /** Requests one run and puts it in the list, replacing that satellite's previous run. */
  async function propagateOne(input: PropagationInput): Promise<OrbitRun> {
    const data = await api.propagate({
      ...refParams(input),
      start: new Date(input.startMs).toISOString(),
      end: new Date(input.endMs).toISOString(),
      step_s: input.stepS,
      ...(input.propagator ? { propagator: input.propagator } : {}),
      ...(input.propagator === 'hpop' && input.hpop ? { hpop: input.hpop } : {}),
    })
    const startMs = Date.parse(data.start)
    const previous = runs.value.find((item) => sameSatellite(item, input))
    const run: OrbitRun = {
      id: `run-${++sequence}`,
      // A pasted element set names its own NORAD number; a catalog run keeps the one asked for.
      noradId: input.customId != null ? data.element_set.norad_id : input.noradId,
      customId: input.customId,
      ...(input.kind ? { kind: input.kind } : {}),
      name: data.element_set.name,
      colorIndex: previous?.colorIndex ?? colorCounter++,
      visible: previous?.visible ?? true,
      startMs,
      stopMs: startMs + (data.count - 1) * data.step_s * 1000,
      propagator: data.propagator,
      hpop: data.propagator === 'hpop' ? (input.hpop ?? null) : null,
      data: markRaw(data),
    }
    runs.value = previous
      ? runs.value.map((item) => (item.id === previous.id ? run : item))
      : [...runs.value, run]
    if (previous) {
      if (selectedRunId.value === previous.id) selectedRunId.value = run.id
      if (trackedRunId.value === previous.id) trackedRunId.value = run.id
      if (hoveredRunId.value === previous.id) hoveredRunId.value = null
    }
    return run
  }

  /**
   * Propagates several satellites over the same window, one request after another. A failure
   * is noted against its satellite and the rest carry on; the clock then spans every new run
   * and the first one opens in the swath inspector.
   */
  async function propagateMany(inputs: readonly PropagationInput[]): Promise<OrbitRun[]> {
    if (loading.value || !inputs.length) return []
    loading.value = true
    error.value = ''
    failures.value = []
    progress.value = { done: 0, total: inputs.length }
    const made: OrbitRun[] = []
    try {
      for (const input of inputs) {
        try {
          made.push(await propagateOne(input))
        } catch (caught) {
          const message = caught instanceof ApiError ? caught.message : String(caught)
          failures.value = [
            ...failures.value,
            { name: input.name ?? `NORAD ${input.noradId}`, message },
          ]
        }
        progress.value = { done: progress.value.done + 1, total: inputs.length }
      }
    } finally {
      loading.value = false
      progress.value = null
    }
    if (failures.value.length) error.value = failures.value.map((item) => item.message).join('\n')
    if (made.length) {
      useClockStore().setRange(
        Math.min(...made.map((run) => run.startMs)),
        Math.max(...made.map((run) => run.stopMs)),
      )
      // A fresh run opens the swath inspector, the next thing one looks at after propagating.
      selectedRunId.value = made[0]!.id
    }
    return made
  }

  async function propagate(input: PropagationInput): Promise<OrbitRun | null> {
    return (await propagateMany([input]))[0] ?? null
  }

  function select(id: string | null) {
    selectedRunId.value = id
    const run = selectedRun.value
    if (run) useClockStore().setRange(run.startMs, run.stopMs, false)
  }

  /** Follow a run's satellite with the camera, or stop following with `null`. */
  function track(id: string | null) {
    const run = id ? runs.value.find((item) => item.id === id) : undefined
    if (id && !run) return
    if (run) {
      if (!run.visible) update(run.id, { visible: true })
      // Selecting clamps the clock into the run, where the marker has a position to follow.
      select(run.id)
    }
    trackedRunId.value = id
  }

  function toggleVisible(id: string) {
    const run = runs.value.find((item) => item.id === id)
    if (!run) return
    if (run.visible && trackedRunId.value === id) trackedRunId.value = null
    update(id, { visible: !run.visible })
  }

  function remove(id: string) {
    runs.value = runs.value.filter((run) => run.id !== id)
    if (selectedRunId.value === id) selectedRunId.value = null
    if (trackedRunId.value === id) trackedRunId.value = null
    if (!runs.value.length) useClockStore().clearRange()
  }

  const resume = selectedRun.value ?? runs.value.at(-1)
  if (resume) useClockStore().setRange(resume.startMs, resume.stopMs, false)

  if (storage) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let warned = false
    watch([runs, selectedRunId], () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (persistenceSuspended()) return
        const saved = saveRuns(storage, { runs: runs.value, selectedRunId: selectedRunId.value })
        if (!saved && !warned) {
          warned = true
          console.warn('Propagation runs are too large to keep across a page reload.')
        }
      }, 300)
    })
  }

  return {
    runs,
    selectedRunId,
    selectedRun,
    hoveredRunId,
    trackedRunId,
    loading,
    error,
    failures,
    progress,
    propagate,
    propagateMany,
    select,
    track,
    toggleVisible,
    remove,
  }
})
