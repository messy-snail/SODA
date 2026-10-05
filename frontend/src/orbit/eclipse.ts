/**
 * Reading the eclipse intervals of a propagation (`eclipse_s`, computed by the backend) and
 * turning them into things to draw. Free of Vue and Cesium so it can be unit tested.
 */

interface EclipseData {
  eclipse_s?: number[] | null
}

/**
 * Flat `[enter0, exit0, ...]` in seconds from the run start, or null when the run carries no
 * usable eclipse data (no solar ephemeris on the server, or a run stored by an older version).
 */
export function eclipseIntervals(data: EclipseData): number[] | null {
  const values = data.eclipse_s
  if (!Array.isArray(values) || values.length % 2 !== 0) return null
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    if (i > 0 && value < values[i - 1]!) return null
  }
  return values
}

/** Whether `value` falls inside one of the flat `[enter, exit, ...]` intervals. */
export function eclipsedAt(intervals: readonly number[], value: number): boolean {
  for (let i = 0; i + 1 < intervals.length; i += 2) {
    if (value < intervals[i]!) return false
    if (value <= intervals[i + 1]!) return true
  }
  return false
}

interface RadiusData {
  count: number
  step_s: number
  fixed_m: readonly (number | null)[]
}

/**
 * Geocentric distance of the satellite `offsetS` seconds into the run, interpolated between
 * samples, or null outside the run or next to a sample that failed to propagate.
 */
export function radiusAtM(data: RadiusData, offsetS: number): number | null {
  const position = offsetS / data.step_s
  if (!(position >= 0) || position > data.count - 1) return null
  const before = Math.floor(position)
  const fraction = position - before
  const radius = (index: number) =>
    Math.hypot(
      data.fixed_m[3 * index] ?? NaN,
      data.fixed_m[3 * index + 1] ?? NaN,
      data.fixed_m[3 * index + 2] ?? NaN,
    )
  const value =
    fraction === 0
      ? radius(before)
      : radius(before) + (radius(before + 1) - radius(before)) * fraction
  return Number.isFinite(value) ? value : null
}

/** Alpha of a fully eclipsed stretch of the timeline, out of 255. */
const BAND_ALPHA = 0xb3

function hexAlpha(fraction: number): string {
  return Math.round(BAND_ALPHA * Math.min(Math.max(fraction, 0), 1))
    .toString(16)
    .padStart(2, '0')
}

/**
 * A CSS `linear-gradient` that marks the eclipsed stretches of `[startMs, stopMs]`, or `none`.
 *
 * Up to `maxBands` eclipses are drawn exactly. A longer range (a month of low orbit has
 * hundreds) is cut into `maxBands` equal bins, each as opaque as the share of it in eclipse,
 * so the gradient stays small however long the range is.
 *
 * @param intervalsMs Flat `[enter0, exit0, ...]` in epoch ms, ascending.
 * @param color `#rrggbb`.
 */
export function eclipseGradient(
  intervalsMs: readonly number[],
  startMs: number,
  stopMs: number,
  color: string,
  maxBands = 120,
): string {
  const span = stopMs - startMs
  if (!(span > 0)) return 'none'
  const visible: [number, number][] = []
  for (let i = 0; i + 1 < intervalsMs.length; i += 2) {
    const from = Math.max(intervalsMs[i]!, startMs)
    const to = Math.min(intervalsMs[i + 1]!, stopMs)
    if (to > from) visible.push([from, to])
  }
  if (!visible.length) return 'none'
  const pct = (ms: number) => `${(((ms - startMs) / span) * 100).toFixed(3)}%`
  const stops: string[] = []
  const band = (paint: string, from: number, to: number) =>
    stops.push(`${paint} ${pct(from)}`, `${paint} ${pct(to)}`)

  if (visible.length <= maxBands) {
    const solid = `${color}${hexAlpha(1)}`
    let cursor = startMs
    for (const [from, to] of visible) {
      if (from > cursor) band('transparent', cursor, from)
      band(solid, from, to)
      cursor = to
    }
    if (cursor < stopMs) band('transparent', cursor, stopMs)
  } else {
    const width = span / maxBands
    const dark = new Array<number>(maxBands).fill(0)
    for (const [from, to] of visible) {
      const first = Math.floor((from - startMs) / width)
      const last = Math.min(Math.floor((to - startMs) / width), maxBands - 1)
      for (let bin = first; bin <= last; bin++) {
        const binStart = startMs + bin * width
        dark[bin]! += Math.max(Math.min(to, binStart + width) - Math.max(from, binStart), 0)
      }
    }
    dark.forEach((ms, bin) => {
      const binStart = startMs + bin * width
      band(`${color}${hexAlpha(ms / width)}`, binStart, binStart + width)
    })
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}
