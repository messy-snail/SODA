import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { SwathResponse } from '../api/types'
import { loadSensor, saveSensor, toSensorRequest, type SensorSettings } from '../sensors/presets'
import { refParams } from '../utils/satelliteRef'
import { useRunsStore, type OrbitRun } from './runs'

export const DRAW_STORAGE_KEY = 'soda.swath.draw'

/** Browser storage for the draw switch; smoke tests (`?e2e`) always start with it off. */
function drawStorage(): Storage | null {
  try {
    return new URLSearchParams(location.search).has('e2e') ? null : localStorage
  } catch {
    return null
  }
}

function readDraw(storage: Storage | null): boolean {
  try {
    return storage?.getItem(DRAW_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Swath state for the selected orbit run. Nothing is computed until the user turns
 * `drawEnabled` on: a long run makes the swath slow to draw.
 */
export const useSelectionStore = defineStore('selection', () => {
  const runs = useRunsStore()
  const storage = drawStorage()
  const drawEnabled = ref(readDraw(storage))
  const sensor = ref<SensorSettings>(loadSensor({ noradId: 0, customId: null }))
  const toggles = reactive({ nadir: true, fieldOfRegard: true, daylightOnly: false, cone: true })
  const swath = shallowRef<SwathResponse | null>(null)
  const swathRunId = ref<string | null>(null)
  /** Sensor settings the current `swath` was computed with; the sensor fan follows these. */
  const appliedSensor = shallowRef<SensorSettings | null>(null)
  const loading = ref(false)
  /** True while the globe builds the swath primitives (set by the swath layer). */
  const drawing = ref(false)
  /** Blocks of fill on the globe so far, out of how many, while `drawing`. */
  const drawProgress = ref<{ done: number; total: number } | null>(null)
  const busy = computed(() => loading.value || drawing.value)
  const error = ref('')
  let controller: AbortController | null = null

  async function fetchSwath(run: OrbitRun) {
    controller?.abort()
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    const settings = { ...sensor.value }
    try {
      const result = await api.swath(
        {
          ...refParams(run),
          start: new Date(run.startMs).toISOString(),
          end: new Date(run.stopMs).toISOString(),
          step_s: run.data.step_s,
          propagator: run.propagator,
          ...(run.hpop ? { hpop: run.hpop } : {}),
          sensor: toSensorRequest(settings),
        },
        request.signal,
      )
      if (request.signal.aborted) return
      appliedSensor.value = settings
      swath.value = result
      swathRunId.value = run.id
    } catch (caught) {
      if (request.signal.aborted || (caught as Error).name === 'AbortError') return
      error.value = caught instanceof ApiError ? caught.message : String(caught)
      swath.value = null
    } finally {
      if (controller === request) loading.value = false
    }
  }

  async function applySensor(settings: SensorSettings) {
    sensor.value = { ...settings }
    const run = runs.selectedRun
    if (!run) return
    saveSensor(run, sensor.value)
    if (drawEnabled.value) await fetchSwath(run)
  }

  /** Drops the current swath (and any request for one), which also clears it off the globe. */
  function clear() {
    controller?.abort()
    controller = null
    loading.value = false
    swath.value = null
    swathRunId.value = null
    appliedSensor.value = null
    error.value = ''
  }

  watch(
    () => runs.selectedRun,
    (run, previous) => {
      if (run?.id === previous?.id) return
      clear()
      if (!run) return
      sensor.value = loadSensor(run)
      if (drawEnabled.value) void fetchSwath(run)
    },
  )

  watch(drawEnabled, (enabled) => {
    try {
      storage?.setItem(DRAW_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Storage blocked: the switch just does not survive a reload.
    }
    const run = runs.selectedRun
    if (!enabled) clear()
    else if (run && swathRunId.value !== run.id) void fetchSwath(run)
  })

  return {
    drawEnabled,
    sensor,
    toggles,
    swath,
    swathRunId,
    appliedSensor,
    loading,
    drawing,
    drawProgress,
    busy,
    error,
    applySensor,
  }
})
