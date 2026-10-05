/** A map scale: a round ground length and how wide it is drawn on screen. */
export interface ScaleBar {
  length_m: number
  width_px: number
}

/**
 * The longest 1-2-5 length that fits in `maxWidthPx` at the given ground resolution.
 *
 * @param metresPerPx Ground metres one screen pixel covers at the measured spot.
 * @returns Null when the resolution is not a usable number.
 */
export function pickScaleBar(metresPerPx: number, maxWidthPx = 120): ScaleBar | null {
  if (!Number.isFinite(metresPerPx) || metresPerPx <= 0 || maxWidthPx <= 0) return null
  const longest = metresPerPx * maxWidthPx
  const decade = 10 ** Math.floor(Math.log10(longest))
  const step = [5, 2, 1].find((candidate) => candidate * decade <= longest) ?? 1
  // toPrecision removes the float noise of a negative power of ten (0.5 m, not 0.5000000001).
  const length_m = Number((step * decade).toPrecision(1))
  return { length_m, width_px: Math.round(length_m / metresPerPx) }
}

/** The number and unit to print for a scale length: metres below a kilometre, else km. */
export function scaleLabel(length_m: number): { value: number; unit: 'm' | 'km' } {
  return length_m >= 1000
    ? { value: Number((length_m / 1000).toPrecision(1)), unit: 'km' }
    : { value: length_m, unit: 'm' }
}

/**
 * `[west, south, east, north]` of points in degrees, or null when they span more than half
 * the globe in longitude, which is what a view across the antimeridian looks like.
 */
export function viewBounds(
  points: readonly (readonly [number, number])[],
): readonly [number, number, number, number] | null {
  if (!points.length) return null
  const lons = points.map((point) => point[0])
  const lats = points.map((point) => point[1])
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  if (east - west >= 180) return null
  return [west, Math.min(...lats), east, Math.max(...lats)]
}
