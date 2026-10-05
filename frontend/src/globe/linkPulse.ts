/** A packet shown as a dot travelling the TC/TM link. Pure, so vitest can reach it. */

/** How long a dot takes from one end of the link to the other, in wall-clock ms. */
export const PULSE_MS = 600

type Vec3 = readonly [number, number, number]

/**
 * Where a packet dot is ``elapsedMs`` after it left: ground to satellite for an uplink,
 * the other way for a downlink.
 *
 * @returns ``[x, y, z]`` in the units of the inputs, or null before it leaves or after it arrives.
 */
export function pulsePosition(
  ground: Vec3,
  satellite: Vec3,
  dir: 'up' | 'down',
  elapsedMs: number,
  durationMs = PULSE_MS,
): [number, number, number] | null {
  if (!(elapsedMs >= 0 && elapsedMs <= durationMs) || durationMs <= 0) return null
  const f = elapsedMs / durationMs
  const [from, to] = dir === 'up' ? [ground, satellite] : [satellite, ground]
  return [
    from[0] + (to[0] - from[0]) * f,
    from[1] + (to[1] - from[1]) * f,
    from[2] + (to[2] - from[2]) * f,
  ]
}
