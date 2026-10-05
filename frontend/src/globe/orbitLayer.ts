import {
  Cartesian3,
  Color,
  ColorBlendMode,
  Entity,
  JulianDate,
  LagrangePolynomialApproximation,
  LabelStyle,
  ModelGraphics,
  ReferenceFrame,
  SampledPositionProperty,
  TimeInterval,
  TimeIntervalCollection,
  VerticalOrigin,
  Cartesian2,
  ConstantProperty,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { modelUrl } from '../api/client'
import type { ModelInfo } from '../api/types'
import { GLB_MODELS } from '../features'
import { useLayersStore } from '../stores/layers'
import { useLogosStore } from '../stores/logos'
import { useModelsStore } from '../stores/models'
import { useRunsStore, type OrbitRun } from '../stores/runs'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { createOrbitTrail } from './orbitTrail'
export type { OrbitPickId } from './orbitTrail'
import { offsetQuaternion, orbitalOrientation } from './satelliteModel'
import { createShapeCache, type SolidShape } from './satelliteShape'
import { crispLabel } from './labelStyle'

interface RunGraphics {
  run: OrbitRun
  lines: ReturnType<typeof createOrbitTrail>['lines']
  trail: ReturnType<typeof createOrbitTrail>
  marker: Entity
  position: SampledPositionProperty
  /** Identifies the model (GLB file or generated shape) currently attached to the marker. */
  modelKey: string
  /** The look the marker should show; differs from `modelKey` while a shape is generated. */
  wantedKey: string
}

/**
 * Tracking camera offset behind, beside, and above a model, in metres along track, cross track,
 * and up. Without it Cesium frames the model's bounding sphere, which `minimumPixelSize` inflates
 * in proportion to the camera distance, so tracking would start thousands of kilometres away.
 */
const MODEL_VIEW_FROM = new ConstantProperty(new Cartesian3(-120, -80, 60))
const NO_OFFSET = offsetQuaternion({ heading_deg: 0, pitch_deg: 0, roll_deg: 0 })
const POINT_LABEL_OFFSET = new Cartesian2(0, -12)

export function runColor(run: OrbitRun, palette: readonly string[]): Color {
  return Color.fromCssColorString(orbitColorHex(run.colorIndex, palette))
}

export function markerId(runId: string) {
  return `marker:${runId}`
}

function positionsFor(run: OrbitRun): Cartesian3[] {
  const flat = run.data.fixed_m
  const positions = new Array<Cartesian3>(run.data.count)
  for (let i = 0; i < run.data.count; i++) {
    positions[i] = new Cartesian3(flat[3 * i], flat[3 * i + 1], flat[3 * i + 2])
  }
  return positions
}

function buildMarker(run: OrbitRun, positions: Cartesian3[], color: Color) {
  const epoch = JulianDate.fromDate(new Date(run.startMs))
  const property = new SampledPositionProperty(ReferenceFrame.FIXED)
  property.setInterpolationOptions({
    interpolationAlgorithm: LagrangePolynomialApproximation,
    interpolationDegree: 5,
  })
  const invalid = new Set(run.data.invalid)
  const times: JulianDate[] = []
  const values: Cartesian3[] = []
  positions.forEach((position, i) => {
    if (invalid.has(i)) return
    times.push(JulianDate.addSeconds(epoch, i * run.data.step_s, new JulianDate()))
    values.push(position)
  })
  property.addSamples(times, values)
  const first = times[0]
  const last = times[times.length - 1]
  return new Entity({
    id: markerId(run.id),
    name: run.name,
    availability:
      first && last
        ? new TimeIntervalCollection([new TimeInterval({ start: first, stop: last })])
        : undefined,
    position: property,
    point: { pixelSize: 9, color, outlineColor: Color.WHITE, outlineWidth: 2 },
    label: {
      text: run.name,
      ...crispLabel(13),
      style: LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Color.BLACK.withAlpha(0.7),
      fillColor: Color.WHITE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: POINT_LABEL_OFFSET,
    },
  })
}

function runIdOf(entity: Entity | undefined): string | null {
  return entity?.id.startsWith('marker:') ? entity.id.slice('marker:'.length) : null
}

/** Draws each propagation run as a pickable polyline plus a moving satellite marker or model. */
export function useOrbitLayer(viewer: Viewer) {
  const runsStore = useRunsStore()
  const layers = useLayersStore()
  const models = useModelsStore()
  const logos = useLogosStore()
  const theme = useThemePreset()
  const shapes = createShapeCache()
  const graphics = new Map<string, RunGraphics>()
  let applyingTracking = false

  function dispose(entry: RunGraphics) {
    viewer.scene.primitives.remove(entry.lines)
    viewer.entities.remove(entry.marker)
  }

  function create(run: OrbitRun): RunGraphics {
    const positions = positionsFor(run)
    const color = runColor(run, theme.preset.globe.orbitPalette)
    const marker = viewer.entities.add(buildMarker(run, positions, color))
    const position = marker.position as SampledPositionProperty
    const trail = createOrbitTrail(run, positions)
    viewer.scene.primitives.add(trail.lines)
    return { run, lines: trail.lines, trail, marker, position, modelKey: '', wantedKey: '' }
  }

  /** Show the point, or hide it and lift the label above a model at least `modelPx` wide. */
  function showMarker(entry: RunGraphics, modelPx: number | null) {
    const { point, label } = entry.marker
    if (point) point.show = new ConstantProperty(modelPx === null)
    if (label) {
      label.pixelOffset = new ConstantProperty(
        modelPx === null ? POINT_LABEL_OFFSET : new Cartesian2(0, -(modelPx / 2 + 6)),
      )
    }
  }

  function attachModel(entry: RunGraphics, key: string, uri: string, offset = NO_OFFSET) {
    const { marker } = entry
    marker.model = new ModelGraphics({ uri })
    marker.orientation = orbitalOrientation(entry.position, offset)
    marker.viewFrom = MODEL_VIEW_FROM
    entry.modelKey = key
  }

  function detachModel(entry: RunGraphics) {
    const { marker } = entry
    marker.model = undefined
    marker.orientation = undefined
    marker.viewFrom = undefined
    entry.modelKey = ''
  }

  function applyGlbModel(entry: RunGraphics, info: ModelInfo, color: Color, emphasized: boolean) {
    const { settings } = info
    const key = ['glb', info.name, info.updated_at]
      .concat([settings.heading_deg, settings.pitch_deg, settings.roll_deg].map(String))
      .join('|')
    entry.wantedKey = key
    if (entry.modelKey !== key) {
      attachModel(entry, key, modelUrl(info), offsetQuaternion(settings))
    }
    const model = entry.marker.model!
    model.scale = new ConstantProperty(settings.scale)
    model.minimumPixelSize = new ConstantProperty(settings.minimum_size_px)
    model.silhouetteColor = new ConstantProperty(color)
    model.silhouetteSize = new ConstantProperty(emphasized ? 2 : 0)
    showMarker(entry, settings.minimum_size_px)
  }

  function applyShape(entry: RunGraphics, shape: SolidShape, color: Color, emphasized: boolean) {
    const logo = logos.logoFor(entry.run.noradId, entry.run.name)
    const { key, url } = shapes.get(shape, logo, theme.preset.globe.logoBackground)
    entry.wantedKey = key
    if (entry.modelKey !== key) {
      // Keep the current look until the generated GLB is ready, then restyle with it attached.
      if (!entry.modelKey) showMarker(entry, null)
      void url.then((uri) => {
        if (viewer.isDestroyed() || graphics.get(entry.run.id) !== entry) return
        if (entry.wantedKey !== key) return
        attachModel(entry, key, uri)
        style(entry)
      })
      return
    }
    const { size_m, minimum_size_px } = layers.prefs.markerStyle
    const model = entry.marker.model!
    model.scale = new ConstantProperty(size_m)
    model.minimumPixelSize = new ConstantProperty(minimum_size_px)
    model.silhouetteColor = new ConstantProperty(color)
    if (logo) {
      // The run color outlines logo shapes; plain shapes are tinted with it instead.
      model.silhouetteSize = new ConstantProperty(emphasized ? 2 : 1)
    } else {
      model.color = new ConstantProperty(color)
      model.colorBlendMode = new ConstantProperty(ColorBlendMode.HIGHLIGHT)
      model.silhouetteSize = new ConstantProperty(emphasized ? 2 : 0)
    }
    showMarker(entry, minimum_size_px)
  }

  /** GLB model when enabled and available, else the chosen shape, else the plain point. */
  function applyAppearance(entry: RunGraphics, color: Color, emphasized: boolean) {
    const glb = GLB_MODELS && layers.prefs.showModels ? models.modelFor(entry.run.noradId) : null
    const { shape } = layers.prefs.markerStyle
    if (glb) applyGlbModel(entry, glb, color, emphasized)
    else if (shape !== 'point') applyShape(entry, shape, color, emphasized)
    else {
      entry.wantedKey = ''
      if (entry.modelKey) detachModel(entry)
      showMarker(entry, null)
    }
  }

  function pruneShapes() {
    const keep = new Set<string>()
    for (const entry of graphics.values()) keep.add(entry.modelKey).add(entry.wantedKey)
    shapes.prune(keep)
  }

  /** Point the camera at the tracked run without disturbing tracking of other entities. */
  function applyTracking() {
    const id = runsStore.trackedRunId
    const entry = id ? graphics.get(id) : undefined
    const target = entry?.run.visible ? entry.marker : undefined
    const current = viewer.trackedEntity
    if (current === target || (!target && runIdOf(current) === null)) return
    applyingTracking = true
    try {
      viewer.trackedEntity = target
    } finally {
      applyingTracking = false
    }
  }

  // Double-clicking a marker (Cesium's default) or removing it also changes the tracked entity.
  const removeTrackedListener = viewer.trackedEntityChanged.addEventListener((entity?: Entity) => {
    if (applyingTracking) return
    const id = runIdOf(entity)
    if (runsStore.trackedRunId !== id) runsStore.track(id)
  })

  function style(entry: RunGraphics) {
    const { run } = entry
    const color = runColor(run, theme.preset.globe.orbitPalette)
    const emphasized = run.id === runsStore.selectedRunId || run.id === runsStore.hoveredRunId
    const dimmed = runsStore.selectedRunId !== null && run.id !== runsStore.selectedRunId
    const lineColor = color.withAlpha(dimmed ? 0.45 : 0.95)
    const { trust, eclipse } = theme.preset.globe
    entry.trail.style(
      lineColor,
      emphasized ? 4 : 2,
      trust,
      layers.prefs.showEclipse ? eclipse : undefined,
    )
    entry.lines.show = run.visible
    entry.marker.show = run.visible
    if (entry.marker.point) entry.marker.point.color = new ConstantProperty(color)
    applyAppearance(entry, color, emphasized)
  }

  function sync() {
    const current = new Map(runsStore.runs.map((run) => [run.id, run]))
    // Rebuilding a marker drops Cesium's tracking; keep the store's intent and re-apply it below.
    applyingTracking = true
    try {
      for (const [id, entry] of graphics) {
        if (!current.has(id) || current.get(id)!.data !== entry.run.data) {
          dispose(entry)
          graphics.delete(id)
        }
      }
    } finally {
      applyingTracking = false
    }
    for (const run of runsStore.runs) {
      const entry = graphics.get(run.id) ?? create(run)
      entry.run = run
      graphics.set(run.id, entry)
      style(entry)
    }
    pruneShapes()
    applyTracking()
  }

  watch(
    () => runsStore.runs,
    () => {
      if (!viewer.isDestroyed()) sync()
    },
    { immediate: true },
  )
  watch(
    () => [
      runsStore.selectedRunId,
      runsStore.hoveredRunId,
      theme.preset.id,
      models.items,
      layers.prefs.showModels,
      layers.prefs.showEclipse,
      logos.items,
      layers.prefs.markerStyle.shape,
      layers.prefs.markerStyle.size_m,
      layers.prefs.markerStyle.minimum_size_px,
    ],
    () => {
      graphics.forEach(style)
      pruneShapes()
    },
  )
  watch(() => runsStore.trackedRunId, applyTracking)

  return {
    graphics,
    dispose() {
      removeTrackedListener()
      graphics.forEach(dispose)
      graphics.clear()
      shapes.dispose()
    },
  }
}
