import {
  Cartesian3,
  Color,
  JulianDate,
  NearFarScalar,
  PointPrimitiveCollection,
  type PointPrimitive,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { api, ApiError } from '../api/client'
import type { Category } from '../api/types'
import { translate } from '../i18n'
import { useLayersStore } from '../stores/layers'
import type { WorkerRequest, WorkerResponse } from '../workers/satellites.worker'

const GROUP = 'active'
const MIN_WALL_INTERVAL_MS = 100

/** Every active satellite as a point, propagated in a Web Worker from cached GP data. */
export function useSatelliteCloud(viewer: Viewer) {
  const layers = useLayersStore()
  let worker: Worker | null = null
  let points: PointPrimitiveCollection | null = null
  let handles: PointPrimitive[] = []
  let categories: Category[] = []
  /** 1 where the last propagation produced a position, so restyling never reveals stale points. */
  let valid = new Uint8Array(0)
  let hidden = new Set<Category>()
  let styleDirty = true
  let buffer: Float64Array | null = new Float64Array(0)
  let lastRequest = 0
  let generation = 0

  function stop() {
    generation++
    worker?.terminate()
    worker = null
    if (points) viewer.scene.primitives.remove(points)
    points = null
    handles = []
    valid = new Uint8Array(0)
    buffer = new Float64Array(0)
    layers.cloud.count = 0
    layers.cloud.loading = false
  }

  function applyStyle() {
    styleDirty = false
    const style = layers.prefs.cloudStyle
    const colors = Object.fromEntries(
      Object.entries(layers.categoryColors).map(([key, css]) => [
        key,
        Color.fromCssColorString(css).withAlpha(style.opacity),
      ]),
    ) as Record<Category, Color>
    hidden = new Set(style.hidden)
    handles.forEach((point, i) => {
      const category = categories[i]!
      point.color = colors[category]
      point.pixelSize = style.pointSize
      point.show = valid[i] === 1 && !hidden.has(category)
    })
  }

  function onMessage(event: MessageEvent<WorkerResponse>) {
    const message = event.data
    if (message.type === 'ready') {
      points = viewer.scene.primitives.add(new PointPrimitiveCollection())
      categories = message.categories
      handles = Array.from(message.ids, (id) =>
        points!.add({
          id,
          show: false,
          scaleByDistance: new NearFarScalar(1e6, 1.6, 6e7, 0.8),
        }),
      )
      valid = new Uint8Array(message.ids.length)
      applyStyle()
      buffer = new Float64Array(message.ids.length * 3)
      layers.cloud.count = message.ids.length
      layers.cloud.loading = false
      return
    }
    buffer = message.buffer
    const position = new Cartesian3()
    for (let i = 0; i < handles.length; i++) {
      const x = buffer[3 * i]!
      const point = handles[i]!
      if (Number.isNaN(x)) {
        valid[i] = 0
        point.show = false
        continue
      }
      valid[i] = 1
      point.position = Cartesian3.fromElements(x, buffer[3 * i + 1]!, buffer[3 * i + 2]!, position)
      point.show = !hidden.has(categories[i]!)
    }
  }

  async function start() {
    const current = ++generation
    layers.cloud.loading = true
    layers.cloud.error = ''
    try {
      const omms = (await api.group(GROUP)).filter((omm) => omm.EPHEMERIS_TYPE === 0)
      if (current !== generation) return
      if (!omms.length) {
        layers.cloud.error = translate('layers.cloudNotCached')
        layers.cloud.loading = false
        return
      }
      worker = new Worker(new URL('../workers/satellites.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = onMessage
      const init: WorkerRequest = { type: 'init', omms }
      worker.postMessage(init)
    } catch (error) {
      layers.cloud.error = error instanceof ApiError ? error.message : String(error)
      layers.cloud.loading = false
    }
  }

  // Restyle at most once per frame, then ask for new positions when the worker has returned the
  // previous buffer.
  const removePreRender = viewer.scene.preRender.addEventListener((_scene, time: JulianDate) => {
    if (styleDirty && handles.length) applyStyle()
    if (!worker || !buffer || !handles.length) return
    const now = performance.now()
    if (now - lastRequest < MIN_WALL_INTERVAL_MS) return
    lastRequest = now
    const request: WorkerRequest = {
      type: 'update',
      timeMs: JulianDate.toDate(time).getTime(),
      buffer,
    }
    worker.postMessage(request, [buffer.buffer])
    buffer = null
  })

  watch(
    () => layers.prefs.showSatellites,
    (show) => (show ? void start() : stop()),
    { immediate: true },
  )
  watch(
    [() => layers.categoryColors, () => layers.prefs.cloudStyle],
    () => {
      styleDirty = true
    },
    { deep: true },
  )

  return {
    reload() {
      stop()
      if (layers.prefs.showSatellites) void start()
    },
    dispose() {
      removePreRender()
      stop()
    },
  }
}
