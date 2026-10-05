/** Orbit colours, kept free of Cesium so cards and the globe agree. */

/**
 * Colour of a propagated run.
 *
 * `colorIndex` is a monotonic counter held by the runs store and survives propagating the
 * same satellite again. Beyond the palette it wraps; the name is what tells those apart.
 */
export function orbitColorHex(colorIndex: number, palette: readonly string[]): string {
  if (!palette.length) return '#888888'
  const wrapped = ((colorIndex % palette.length) + palette.length) % palette.length
  return palette[wrapped]!
}
