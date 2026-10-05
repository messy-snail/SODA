import { Cartesian3, Color, PolylineCollection } from 'cesium'
import { eclipsedAt, eclipseIntervals } from '../orbit/eclipse'
import { hasElements } from '../utils/satelliteRef'
import { trustLevel, type TrustLevel } from '../orbit/epochTrust'
import { sampleTimeMs, type OrbitRun } from '../stores/runs'
import { validRanges } from './geometry'

export interface OrbitPickId {
  kind: 'orbit'
  runId: string
  segmentIndex: number
}

/** `#rrggbb` per element-age grade that recolours the line (theme `globe.trust`). */
export type TrustColors = Record<Exclude<TrustLevel, 'ok' | 'caution'>, string>

/**
 * Splits a valid sample range wherever the element-age grade changes. Neighbouring pieces share
 * their boundary sample so the drawn line stays continuous.
 */
export function splitByTrust(
  first: number,
  last: number,
  levelAt: (index: number) => TrustLevel,
): { first: number; last: number; level: TrustLevel }[] {
  const pieces: { first: number; last: number; level: TrustLevel }[] = []
  let start = first
  let level = levelAt(first)
  for (let i = first + 1; i <= last; i++) {
    const next = levelAt(i)
    if (next === level) continue
    pieces.push({ first: start, last: i, level })
    start = i
    level = next
  }
  if (start < last) pieces.push({ first: start, last, level })
  return pieces
}

/** How an eclipsed stretch is dimmed: factors on the line colour's brightness and alpha. */
export interface EclipseLineStyle {
  lineBrightness: number
  lineAlpha: number
}

/** A stretch of the line between two sample positions, which may fall between samples. */
export interface TrailPiece {
  from: number
  to: number
  level: TrustLevel
  eclipsed: boolean
}

/**
 * Cuts each piece again where the satellite enters or leaves the Earth's shadow.
 *
 * @param edges Flat `[enter0, exit0, ...]` as sample positions; they fall between samples, so
 *   the cut ends are fractional and the caller interpolates a vertex there.
 */
export function splitByEclipse(
  pieces: readonly { first: number; last: number; level: TrustLevel }[],
  edges: readonly number[],
): TrailPiece[] {
  return pieces.flatMap(({ first, last, level }) => {
    const cuts = [first, ...edges.filter((edge) => edge > first && edge < last), last]
    return cuts.slice(1).map((to, i) => {
      const from = cuts[i]!
      return { from, to, level, eclipsed: eclipsedAt(edges, (from + to) / 2) }
    })
  })
}

/** Build the entire Earth-fixed path once, keeping the sample times of each pickable segment. */
export function createOrbitTrail(run: OrbitRun, positions: Cartesian3[]) {
  const lines = new PolylineCollection()
  // A state vector run has an epoch too, but the grades are about mean elements ageing.
  const epochMs = hasElements(run) ? Date.parse(run.data.element_set?.epoch ?? '') : NaN
  const levelAt = (index: number): TrustLevel =>
    Number.isNaN(epochMs) ? 'ok' : trustLevel(epochMs, sampleTimeMs(run, index))
  const eclipse = eclipseIntervals(run.data)
  const pieces = splitByEclipse(
    validRanges(run.data.count, run.data.invalid).flatMap(([first, last]) =>
      splitByTrust(first, last, levelAt),
    ),
    eclipse ? eclipse.map((seconds) => seconds / run.data.step_s) : [],
  )
  /** The sample itself, or a point on the chord to the next one for a cut between samples. */
  const positionAt = (index: number): Cartesian3 => {
    const before = Math.floor(index)
    if (before === index) return positions[before]!
    return Cartesian3.lerp(
      positions[before]!,
      positions[before + 1]!,
      index - before,
      new Cartesian3(),
    )
  }
  const segments = pieces.map(({ from, to, level, eclipsed }, index) => {
    const indices = [from]
    for (let i = Math.floor(from) + 1; i < to; i++) indices.push(i)
    indices.push(to)
    const values = indices.map(positionAt)
    const timesMs = indices.map((i) => sampleTimeMs(run, i))
    const id: OrbitPickId = { kind: 'orbit', runId: run.id, segmentIndex: index }
    lines.add({ positions: values, width: 2, id })
    return { positions: values, timesMs, level, eclipsed }
  })

  /**
   * Stretches graded low or poor take the grade colour, keeping the run colour's alpha. With
   * `eclipse` given, eclipsed stretches are then dimmed.
   */
  function style(color: Color, width: number, trust?: TrustColors, eclipse?: EclipseLineStyle) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines.get(i)
      line.width = width
      const { level, eclipsed } = segments[i]!
      const base =
        trust && (level === 'low' || level === 'poor')
          ? Color.fromCssColorString(trust[level]).withAlpha(color.alpha)
          : color
      line.material.uniforms.color =
        eclipse && eclipsed
          ? new Color(
              base.red * eclipse.lineBrightness,
              base.green * eclipse.lineBrightness,
              base.blue * eclipse.lineBrightness,
              base.alpha * eclipse.lineAlpha,
            )
          : base
    }
  }

  return { lines, segments, style }
}
