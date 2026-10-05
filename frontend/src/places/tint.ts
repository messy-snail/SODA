/**
 * Country polygon geometry for the tint overlay and point-in-country lookups, kept free of
 * Cesium and the DOM so it can be unit tested.
 */

import type { Bbox } from './camera'

export interface CountryShape {
  /** Joins the shape to its `Country` entry. */
  a3: string
  iso2: string
  /** Natural Earth MAPCOLOR7: 1-7, chosen so neighbouring countries differ. */
  color: number
  /** Closed flat rings `[lon0, lat0, ...]`; holes are separate rings (even-odd). */
  rings: number[][]
}

export interface IndexedRing {
  ring: number[]
  bbox: Bbox
}

export interface IndexedShape {
  a3: string
  iso2: string
  color: number
  rings: IndexedRing[]
  bbox: Bbox
}

function ringBbox(ring: readonly number[]): Bbox {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const lon = ring[i]!
    const lat = ring[i + 1]!
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return [west, south, east, north]
}

/** Attach bounding boxes so tiles and lookups skip everything far away. */
export function indexShapes(shapes: readonly CountryShape[]): IndexedShape[] {
  return shapes.map((shape) => {
    const rings = shape.rings.map((ring) => ({ ring, bbox: ringBbox(ring) }))
    const bbox: Bbox = [
      Math.min(...rings.map((r) => r.bbox[0])),
      Math.min(...rings.map((r) => r.bbox[1])),
      Math.max(...rings.map((r) => r.bbox[2])),
      Math.max(...rings.map((r) => r.bbox[3])),
    ]
    return { a3: shape.a3, iso2: shape.iso2, color: shape.color, rings, bbox }
  })
}

/**
 * Extent of a tile in Cesium's GeographicTilingScheme: two tiles wide and one tall at
 * level 0, halving each level.
 */
export function tileBbox(x: number, y: number, level: number): Bbox {
  const width = 180 / 2 ** level
  const height = 180 / 2 ** level
  const west = -180 + x * width
  const north = 90 - y * height
  return [west, north - height, west + width, north]
}

export function overlaps(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/** Ray-casting test of one closed ring. */
export function ringContains(ring: readonly number[], lon: number, lat: number): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]!
    const yi = ring[2 * i + 1]!
    const xj = ring[2 * j]!
    const yj = ring[2 * j + 1]!
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** The country whose territory contains the point, or null at sea. */
export function countryAt(
  shapes: readonly IndexedShape[],
  lon: number,
  lat: number,
): IndexedShape | null {
  const point: Bbox = [lon, lat, lon, lat]
  for (const shape of shapes) {
    if (!overlaps(shape.bbox, point)) continue
    // Even-odd over every ring, so a hole (or an enclave inside it) is handled.
    let inside = false
    for (const { ring, bbox } of shape.rings) {
      if (overlaps(bbox, point) && ringContains(ring, lon, lat)) inside = !inside
    }
    if (inside) return shape
  }
  return null
}

const WORLD: Bbox = [-180, -90, 180, 90]

function indexed(ring: number[]): IndexedRing {
  return { ring, bbox: ringBbox(ring) }
}

/** Copies of a flat line shifted by -360, 0 and +360, kept where they touch the map. */
function wrapCopies(flat: readonly number[]): IndexedRing[] {
  const out: IndexedRing[] = []
  for (const shift of [-360, 0, 360]) {
    const moved = flat.map((v, i) => (i % 2 === 0 ? v + shift : v))
    const copy = indexed(moved)
    if (overlaps(copy.bbox, WORLD)) out.push(copy)
  }
  return out
}

/**
 * Turn a closed `[lon, lat]` ring from the API (longitudes wrapped into [-180, 180)) into
 * paintable geometry: `rings` to fill and `lines` to stroke.
 *
 * Longitudes are unwrapped so a ring across the antimeridian stays in one piece, then drawn
 * again shifted by a full turn so both sides of the map get their part. A ring whose
 * longitude winds a full turn encloses a pole (a polar ground station's visibility area);
 * its fill closes along that pole, while the stroke keeps only the real outline.
 */
export function ringToTint(pairs: readonly (readonly number[])[]): {
  rings: IndexedRing[]
  lines: IndexedRing[]
  bbox: Bbox
} {
  const flat: number[] = []
  let lon = 0
  pairs.forEach(([rawLon, lat], i) => {
    if (i === 0) lon = rawLon!
    else {
      const prev = pairs[i - 1]![0]!
      let delta = rawLon! - prev
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      lon += delta
    }
    flat.push(lon, lat!)
  })
  if (flat.length < 6) return { rings: [], lines: [], bbox: [0, 0, 0, 0] }
  const winding = flat[flat.length - 2]! - flat[0]!
  let pole: 90 | -90 | null = null
  if (Math.abs(winding) > 180) {
    const lats = flat.filter((_, i) => i % 2 === 1)
    pole = lats.reduce((a, b) => a + b, 0) / lats.length >= 0 ? 90 : -90
  }
  return unwrappedToTint(flat, pole)
}

/**
 * Paintable geometry for a flat ring whose longitudes are already unwrapped. With `pole` set
 * the ring winds a full turn around that pole and its fill closes along it.
 */
export function unwrappedToTint(
  flat: number[],
  pole: 90 | -90 | null,
): { rings: IndexedRing[]; lines: IndexedRing[]; bbox: Bbox } {
  const fill = pole === null ? flat : [...flat, flat[flat.length - 2]!, pole, flat[0]!, pole]
  const rings = wrapCopies(fill)
  const lines = wrapCopies(flat)
  const all = rings.map((r) => r.bbox)
  const bbox: Bbox = [
    Math.min(...all.map((b) => b[0])),
    Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])),
    Math.max(...all.map((b) => b[3])),
  ]
  return { rings, lines, bbox }
}
