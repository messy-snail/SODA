import { Cartesian3 } from 'cesium'

import type { OrbitRun } from '../stores/runs'

/** Prefer an explicit selection, even when hidden; otherwise use the latest visible result. */
export function referenceTarget(
  runs: readonly OrbitRun[],
  selectedId: string | null,
): OrbitRun | null {
  return (
    runs.find((run) => run.id === selectedId) ??
    [...runs].reverse().find((run) => run.visible) ??
    null
  )
}

/** Sample indices (fractional at the boundaries) for one future revolution, split at gaps. */
export function referenceSegments(
  startMs: number,
  stopMs: number,
  stepMs: number,
  periodMin: number,
  currentMs: number,
  ranges: readonly (readonly [number, number])[],
): number[][] {
  if (currentMs < startMs || currentMs >= stopMs || !Number.isFinite(periodMin) || periodMin <= 0)
    return []
  const from = (currentMs - startMs) / stepMs
  const to = (Math.min(stopMs, currentMs + periodMin * 60_000) - startMs) / stepMs
  return ranges.flatMap(([first, last]) => {
    const lo = Math.max(first, from)
    const hi = Math.min(last, to)
    if (hi <= lo) return []
    const indices = [lo]
    for (let i = Math.floor(lo) + 1; i < hi; i++) indices.push(i)
    indices.push(hi)
    return [indices]
  })
}

/** Resolve segment indices to positions, interpolating the fractional endpoints. */
export function segmentPositions(
  indices: readonly number[],
  positions: readonly Cartesian3[],
): Cartesian3[] {
  return indices.map((index) =>
    Number.isInteger(index)
      ? positions[index]!
      : Cartesian3.lerp(
          positions[Math.floor(index)]!,
          positions[Math.ceil(index)]!,
          index % 1,
          new Cartesian3(),
        ),
  )
}
