import {
  ArcType,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  Ellipsoid,
  GeometryInstance,
  Material,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  Primitive,
  PrimitiveCollection,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import type { SwathResponse, SwathSegment } from '../api/types'
import { useClockStore } from '../stores/clock'
import { useRunsStore } from '../stores/runs'
import { useSelectionStore } from '../stores/selection'
import { useThemePreset } from '../theme/useThemePreset'
import { blocksNearest, chunkSize, stripRings, subdivisions } from './geometry'

const FILL_ALPHA = { nadir: 0.6, for: 0.28, night: 0.25 }
const EDGE = { nadir: { alpha: 1, width: 2.5 }, for: { alpha: 0.85, width: 1.5 } }
/** Dash period of a night edge, in pixels. */
const NIGHT_DASH_PX = 12
/** Fill is built a block at a time; about one low orbit, or a 24th of a long run. */
const BLOCK_S = 6000
const MAX_BLOCKS = 24

type Kind = SwathSegment['kind']
/** What the three display switches act on. */
interface Shown {
  kind: Kind
  daylight: boolean
}
/** What a smoke test can read about the last build (`?e2e` only). */
interface SwathTiming {
  /** Main-thread time spent creating the edge lines and the fill instances. */
  syncMs: number
  /** Until the first block of fill was on the globe, and until the last. */
  firstMs: number | null
  totalMs: number | null
  blocks: number
}

/**
 * Renders nadir swath and field-of-regard strips for the selected run.
 *
 * Edge lines go up at once: they are plain polylines, cheap, and keep a narrow swath visible
 * from far away. The filled strips are polygons on the ellipsoid, which Cesium tessellates in
 * workers; for a long run that takes a while, so they are added a block of time after
 * another, starting around the clock. The display switches only show and hide what is built.
 *
 * Neither is clamped to terrain. The globe has none, and ground-clamped lines and classified
 * polygons cost many times more to build and to draw each frame.
 */
export function useSwathLayer(viewer: Viewer) {
  const selection = useSelectionStore()
  const runs = useRunsStore()
  const clock = useClockStore()
  const theme = useThemePreset()
  const e2e = new URLSearchParams(location.search).has('e2e')
  /** Field of regard under nadir, whatever the order their blocks are built in. */
  let layers: Record<Kind, PrimitiveCollection> | null = null
  let fills: (Shown & { primitive: Primitive })[] = []
  let edges: PolylineCollection | null = null
  let edgeGroups: Shown[] = []
  let stopBuilding: (() => void) | null = null

  function settle() {
    stopBuilding?.()
    stopBuilding = null
    selection.drawing = false
    selection.drawProgress = null
  }

  function clear() {
    settle()
    if (layers) {
      viewer.scene.primitives.remove(layers.for)
      viewer.scene.primitives.remove(layers.nadir)
    }
    if (edges) viewer.scene.primitives.remove(edges)
    layers = null
    edges = null
    fills = []
    edgeGroups = []
  }

  function shown({ kind, daylight }: Shown): boolean {
    const { toggles } = selection
    if (!runs.selectedRun?.visible) return false
    if (kind === 'nadir' ? !toggles.nadir : !toggles.fieldOfRegard) return false
    return daylight || !toggles.daylightOnly
  }

  function applyShown() {
    for (const fill of fills) fill.primitive.show = shown(fill)
    edgeGroups.forEach((group, index) => (edges!.get(index).show = shown(group)))
  }

  function baseColor(segment: Shown): Color {
    const globe = theme.preset.globe
    if (!segment.daylight) return Color.fromCssColorString(globe.night)
    return Color.fromCssColorString(segment.kind === 'nadir' ? globe.nadir : globe.fieldOfRegard)
  }

  /**
   * An edge as points on the ellipsoid close enough together that the straight line between
   * two of them does not sink out of sight under the surface.
   */
  function edgePositions(side: number[]): Cartesian3[] {
    const samples = Cartesian3.fromDegreesArray(side)
    const positions: Cartesian3[] = samples.length ? [samples[0]!] : []
    for (let i = 1; i < samples.length; i++) {
      const from = samples[i - 1]!
      const to = samples[i]!
      const pieces = subdivisions(Cartesian3.distance(from, to))
      for (let k = 1; k < pieces; k++) {
        const point = Cartesian3.lerp(from, to, k / pieces, new Cartesian3())
        positions.push(Ellipsoid.WGS84.scaleToGeodeticSurface(point, point) ?? point)
      }
      positions.push(to)
    }
    return positions
  }

  function addEdges(segments: SwathSegment[]) {
    edges = viewer.scene.primitives.add(new PolylineCollection()) as PolylineCollection
    for (const segment of segments) {
      const style = EDGE[segment.kind]
      const color = baseColor(segment).withAlpha(style.alpha)
      for (const side of [segment.left, segment.right]) {
        edges.add({
          positions: edgePositions(side),
          width: style.width,
          show: shown(segment),
          // A dashed edge marks a stretch the Sun is too low for.
          material: segment.daylight
            ? Material.fromType('Color', { color })
            : Material.fromType('PolylineDash', { color, dashLength: NIGHT_DASH_PX }),
        })
        edgeGroups.push({ kind: segment.kind, daylight: segment.daylight })
      }
    }
  }

  /** The filled strips of one block: a primitive per kind and lighting, so each can be hidden. */
  function addBlock(segments: SwathSegment[], chunk: number) {
    const groups = new Map<string, Shown & { instances: GeometryInstance[] }>()
    for (const segment of segments) {
      const key = `${segment.kind}:${segment.daylight}`
      const group = groups.get(key) ?? { ...segment, instances: [] }
      groups.set(key, group)
      const alpha = segment.daylight ? FILL_ALPHA[segment.kind] : FILL_ALPHA.night
      const color = ColorGeometryInstanceAttribute.fromColor(baseColor(segment).withAlpha(alpha))
      for (const ring of stripRings(segment.left, segment.right, chunk)) {
        group.instances.push(
          new GeometryInstance({
            geometry: new PolygonGeometry({
              polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(ring)),
              arcType: ArcType.GEODESIC,
              vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
            }),
            attributes: { color },
          }),
        )
      }
    }
    const added: Primitive[] = []
    for (const { kind, daylight, instances } of groups.values()) {
      if (!instances.length) continue
      const primitive = layers![kind].add(
        new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          show: shown({ kind, daylight }),
        }),
      ) as Primitive
      fills.push({ kind, daylight, primitive })
      added.push(primitive)
    }
    return added
  }

  function render(swath: SwathResponse | null) {
    clear()
    const run = runs.selectedRun
    if (!swath || !run || selection.swathRunId !== run.id) return
    const started = performance.now()
    const stepS = run.data.step_s
    const { segments } = swath
    layers = {
      for: viewer.scene.primitives.add(new PrimitiveCollection()) as PrimitiveCollection,
      nadir: viewer.scene.primitives.add(new PrimitiveCollection()) as PrimitiveCollection,
    }
    addEdges(segments)

    const spanS = (run.stopMs - run.startMs) / 1000
    const blockSamples = Math.max(BLOCK_S, spanS / MAX_BLOCKS) / stepS
    const nowIndex = (clock.currentMs - run.startMs) / 1000 / stepS
    const queue = blocksNearest(segments, blockSamples, nowIndex)
    const total = queue.length
    const chunk = chunkSize(stepS)
    const timing: SwathTiming = {
      syncMs: performance.now() - started,
      firstMs: null,
      totalMs: null,
      blocks: total,
    }
    if (e2e) (window as Window & { __sodaSwathTiming?: SwathTiming }).__sodaSwathTiming = timing
    if (!total) return

    let building: Primitive[] = []
    let done = 0
    /** Start the next block once the one before it is on the globe. */
    const advance = () => {
      if (building.some((primitive) => !primitive.ready)) return
      if (building.length) {
        done += 1
        timing.firstMs ??= performance.now() - started
      }
      const next = queue.shift()
      if (!next) {
        timing.totalMs = performance.now() - started
        settle()
        return
      }
      const before = performance.now()
      building = addBlock(
        next.map((index) => segments[index]!),
        chunk,
      )
      timing.syncMs += performance.now() - before
      selection.drawProgress = { done, total }
    }
    selection.drawing = true
    // `clear()` removes this listener, so a build that was replaced never advances again.
    stopBuilding = viewer.scene.postRender.addEventListener(advance)
    advance()
  }

  watch(
    () => [selection.swath, selection.swathRunId, theme.preset.id],
    () => render(selection.swath),
    { immediate: true },
  )
  watch(
    () => [
      runs.selectedRun?.visible,
      selection.toggles.nadir,
      selection.toggles.fieldOfRegard,
      selection.toggles.daylightOnly,
    ],
    applyShown,
  )

  return { dispose: clear }
}
