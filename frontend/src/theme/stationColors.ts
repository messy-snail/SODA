/** Ground station colours, kept free of Cesium so cards and the globe agree. */

/**
 * Colour for the nth selected station.
 *
 * The index is a monotonic counter held by the passes store, not a position in the
 * selection, so removing one station never recolours the others. Beyond the palette it
 * wraps; the label is what tells those apart.
 */
export function stationColorHex(index: number, palette: readonly string[]): string {
  if (!palette.length) return '#888888'
  const wrapped = ((index % palette.length) + palette.length) % palette.length
  return palette[wrapped]!
}
