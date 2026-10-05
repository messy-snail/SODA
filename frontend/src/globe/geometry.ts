/** Pure helpers for turning API samples into renderable pieces. */

/** Inclusive index ranges of consecutive valid samples with at least two points. */
export function validRanges(count: number, invalid: readonly number[]): [number, number][] {
  const bad = new Set(invalid)
  const ranges: [number, number][] = []
  let start = -1
  for (let i = 0; i <= count; i++) {
    const ok = i < count && !bad.has(i)
    if (ok && start < 0) start = i
    if (!ok && start >= 0) {
      if (i - 1 > start) ranges.push([start, i - 1])
      start = -1
    }
  }
  return ranges
}

/** Number of samples per swath polygon so each covers roughly ``targetSeconds``. */
export function chunkSize(stepS: number, targetSeconds = 240): number {
  return Math.max(2, Math.round(targetSeconds / stepS))
}

/**
 * Closed rings (flat ``[lon, lat, ...]``) covering a strip between two edges.
 * Consecutive rings share an edge sample so the strip has no gaps.
 */
export function stripRings(left: readonly number[], right: readonly number[], chunk: number) {
  const count = Math.min(left.length, right.length) / 2
  const rings: number[][] = []
  for (let start = 0; start < count - 1; start += chunk) {
    const end = Math.min(start + chunk, count - 1)
    const ring: number[] = []
    for (let i = start; i <= end; i++) ring.push(left[2 * i]!, left[2 * i + 1]!)
    for (let i = end; i >= start; i--) ring.push(right[2 * i]!, right[2 * i + 1]!)
    rings.push(ring)
  }
  return rings
}

/** Index of the point nearest to ``(x, y)``; points with non-finite coordinates are skipped. */
export function nearestIndex(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number, y: number) {
  let best = -1
  let bestDistance = Infinity
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - x
    const dy = ys[i]! - y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/**
 * The point of a polyline nearest to ``(x, y)``, as the segment it lies on and how far along.
 *
 * Segments with a non-finite end are skipped, which is how hidden vertices are left out.
 *
 * @returns ``index`` of the segment's first point and ``fraction`` (0-1) towards the next.
 *   With no whole segment, the nearest single point (fraction 0); null when none is finite.
 */
export function nearestOnPolyline(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  x: number,
  y: number,
): { index: number; fraction: number } | null {
  let best: { index: number; fraction: number } | null = null
  let bestDistance = Infinity
  for (let i = 0; i + 1 < xs.length; i++) {
    const ax = xs[i]!
    const ay = ys[i]!
    const dx = xs[i + 1]! - ax
    const dy = ys[i + 1]! - ay
    if (!Number.isFinite(ax + ay + dx + dy)) continue
    const length = dx * dx + dy * dy
    const fraction =
      length > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / length)) : 0
    const distance = (ax + dx * fraction - x) ** 2 + (ay + dy * fraction - y) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = { index: i, fraction }
    }
  }
  if (best) return best
  const index = nearestIndex(xs, ys, x, y)
  return index < 0 ? null : { index, fraction: 0 }
}

/** Pieces to cut a chord into so that none is longer than ``maxChordM``. */
export function subdivisions(chordM: number, maxChordM = 50_000): number {
  return Number.isFinite(chordM) ? Math.max(1, Math.ceil(chordM / maxChordM)) : 1
}

/**
 * Group spans of samples into blocks of about ``blockSamples`` and order the blocks by how
 * close they are to ``nowIndex``, so what is drawn first is what the clock is looking at.
 *
 * @param spans Inclusive sample ranges, such as the ``i0``/``i1`` of swath segments.
 * @returns Blocks nearest first; each lists the indices of its spans in their given order.
 */
export function blocksNearest(
  spans: readonly { i0: number; i1: number }[],
  blockSamples: number,
  nowIndex: number,
): number[][] {
  const size = Math.max(1, blockSamples)
  const blocks = new Map<number, number[]>()
  spans.forEach((span, index) => {
    const block = Math.floor((span.i0 + span.i1) / 2 / size)
    const members = blocks.get(block)
    if (members) members.push(index)
    else blocks.set(block, [index])
  })
  const distance = (block: number) => Math.abs((block + 0.5) * size - nowIndex)
  return [...blocks.entries()]
    .sort(([a], [b]) => distance(a) - distance(b) || a - b)
    .map(([, members]) => members)
}

type Xyz = { x: number; y: number; z: number }

/**
 * Whether the ellipsoid hides ``point`` from ``camera``: it lies beyond the horizon and
 * behind it. Both are scaled so the ellipsoid is the unit sphere, where the horizon is a
 * cone around the direction to the centre.
 *
 * @param radii Semi-axes of the ellipsoid, in the units of the two positions.
 */
export function hiddenByEllipsoid(camera: Xyz, point: Xyz, radii: Xyz): boolean {
  const cx = camera.x / radii.x
  const cy = camera.y / radii.y
  const cz = camera.z / radii.z
  const tx = point.x / radii.x - cx
  const ty = point.y / radii.y - cy
  const tz = point.z / radii.z - cz
  /** Squared distance from the camera to the horizon. */
  const horizon = cx * cx + cy * cy + cz * cz - 1
  if (horizon <= 0) return false
  const towardCentre = -(tx * cx + ty * cy + tz * cz)
  return (
    towardCentre > horizon &&
    (towardCentre * towardCentre) / (tx * tx + ty * ty + tz * tz) > horizon
  )
}
