/** One vertex of a level drawn by `LevelChart.vue`. */
export interface LevelPoint {
  ms: number
  value: number
}

export interface TimeSpan {
  startMs: number
  endMs: number
}

/**
 * At most about `maxPoints` of a long series, keeping the lowest and highest of every bucket
 * so a curve that swings many times (altitude over days) keeps its envelope.
 */
export function thinExtremes(points: readonly LevelPoint[], maxPoints: number): LevelPoint[] {
  const buckets = Math.floor(maxPoints / 2)
  if (points.length <= maxPoints || buckets < 1) return [...points]
  const size = points.length / buckets
  const kept: LevelPoint[] = []
  for (let bucket = 0; bucket < buckets; bucket++) {
    const slice = points.slice(Math.floor(bucket * size), Math.floor((bucket + 1) * size))
    if (!slice.length) continue
    const low = slice.reduce((best, point) => (point.value < best.value ? point : best))
    const high = slice.reduce((best, point) => (point.value > best.value ? point : best))
    kept.push(...(low === high ? [low] : low.ms < high.ms ? [low, high] : [high, low]))
  }
  return kept
}
