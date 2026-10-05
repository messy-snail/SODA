/** Sampling helpers for the per-pass Earth-fixed track. Pure, so vitest can reach them. */

/**
 * Satellite position at ``ms`` on a pass track sampled evenly from AOS to LOS.
 *
 * @param track Flat ITRS metres ``[x0, y0, z0, ...]`` as sent in ``Pass.track_fixed_m``.
 * @returns ``[x, y, z]`` in metres, or null outside the pass or for an empty track.
 */
export function interpolateTrack(
  track: readonly number[],
  aosMs: number,
  losMs: number,
  ms: number,
): [number, number, number] | null {
  const count = Math.floor(track.length / 3)
  if (count === 0 || ms < aosMs || ms > losMs) return null
  if (count === 1 || losMs <= aosMs) return [track[0], track[1], track[2]]
  const at = ((ms - aosMs) / (losMs - aosMs)) * (count - 1)
  const i = Math.min(Math.floor(at), count - 2)
  const f = at - i
  const a = i * 3
  const b = a + 3
  return [
    track[a] + (track[b] - track[a]) * f,
    track[a + 1] + (track[b + 1] - track[a + 1]) * f,
    track[a + 2] + (track[b + 2] - track[a + 2]) * f,
  ]
}

/** Inclusive sample index range ``[first, last]`` on an evenly sampled pass track. */
export type SampleRange = readonly [number, number]

/**
 * Split a pass track at the edges of the predicted window.
 *
 * A pass already in progress when the window opens (or still running when it closes)
 * keeps its real AOS/LOS, so part of its track lies outside the window. Neighbouring
 * ranges share their boundary sample so the drawn pieces join up.
 *
 * @param count Number of samples, spaced evenly from ``aosMs`` to ``losMs``.
 * @returns The ranges before, inside and after the window; null where there is none.
 */
export function splitAtWindow(
  count: number,
  aosMs: number,
  losMs: number,
  startMs: number,
  endMs: number,
): { before: SampleRange | null; inside: SampleRange | null; after: SampleRange | null } {
  const last = count - 1
  if (count < 2 || losMs <= aosMs) {
    return { before: null, inside: count ? [0, Math.max(last, 0)] : null, after: null }
  }
  const index = (ms: number) =>
    Math.min(last, Math.max(0, Math.round(((ms - aosMs) / (losMs - aosMs)) * last)))
  const from = aosMs < startMs ? index(startMs) : 0
  const to = losMs > endMs ? index(endMs) : last
  const range = (a: number, b: number): SampleRange | null => (b > a ? [a, b] : null)
  return {
    before: range(0, from),
    inside: range(from, to),
    after: range(to, last),
  }
}
