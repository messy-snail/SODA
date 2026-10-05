import {
  Cartesian3,
  Color,
  JulianDate,
  Material,
  Matrix3,
  Matrix4,
  PolylineCollection,
  Transforms,
  type Viewer,
} from 'cesium'
import { useComparisonStore } from '../stores/comparison'
import { useLayersStore } from '../stores/layers'
import type { OrbitRun } from '../stores/runs'
import { useThemePreset } from '../theme/useThemePreset'
import { validRanges } from './geometry'
import { referenceSegments, segmentPositions } from './referencePath'

/** A non-interactive GCRS comparison path; Earth-relative orbit graphics remain untouched. */
export function useInertialReferenceLayer(viewer: Viewer) {
  const comparison = useComparisonStore()
  const layers = useLayersStore()
  const theme = useThemePreset()
  const lines = viewer.scene.primitives.add(new PolylineCollection()) as PolylineCollection
  const rotation = new Matrix3()
  let source: OrbitRun['data'] | null = null
  let ranges: [number, number][] = []
  let positions: Cartesian3[] = []
  let lastUpdate = -Infinity
  let previousMs = NaN
  let previousColor = ''

  const remove = viewer.scene.preRender.addEventListener((_scene, time) => {
    const run = comparison.target
    lines.show = false
    if (!comparison.enabled || layers.effectiveFrame !== 'inertial' || !run?.visible) return
    const currentMs = JulianDate.toDate(time).getTime()
    if (currentMs < run.startMs || currentMs >= run.stopMs) return
    const matrix = Transforms.computeIcrfToFixedMatrix(time, rotation)
    if (!matrix) return
    Matrix4.fromRotationTranslation(matrix, Cartesian3.ZERO, lines.modelMatrix)
    const now = performance.now()
    const changed = source !== run.data
    // Hide obsolete geometry immediately, but limit rebuilding to ten times per second.
    if (changed && now - lastUpdate < 100) return
    if (now - lastUpdate >= 100 && (changed || currentMs !== previousMs)) {
      if (changed) {
        source = run.data
        ranges = validRanges(run.data.count, run.data.invalid)
        positions = Array.from({ length: run.data.count }, (_, i) =>
          Cartesian3.fromArray(run.data.inertial_m, i * 3),
        )
      }
      const segments = referenceSegments(
        run.startMs,
        run.stopMs,
        run.data.step_s * 1000,
        run.data.orbit.period_min,
        currentMs,
        ranges,
      )
      while (lines.length > segments.length) lines.remove(lines.get(lines.length - 1))
      segments.forEach((indices, index) => {
        const values = segmentPositions(indices, positions)
        const line =
          index < lines.length
            ? lines.get(index)
            : lines.add({
                positions: [],
                width: 3,
                material: Material.fromType('PolylineDash'),
                id: { kind: 'inertial-reference', runId: run.id },
              })
        line.id = { kind: 'inertial-reference', runId: run.id }
        line.positions = values
      })
      previousMs = currentMs
      lastUpdate = now
      previousColor = ''
    }
    const color = theme.preset.globe.inertialReference
    if (previousColor !== color) {
      for (let i = 0; i < lines.length; i++)
        lines.get(i).material.uniforms.color = Color.fromCssColorString(color)
      previousColor = color
    }
    lines.show = lines.length > 0
  })
  return {
    dispose() {
      remove()
      viewer.scene.primitives.remove(lines)
    },
  }
}
