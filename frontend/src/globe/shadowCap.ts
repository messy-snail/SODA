/**
 * Spherical caps for the map: the night side of the Earth and the Earth's shadow at a
 * satellite's height. Free of Cesium so it can be unit tested; the result is painted by
 * `tintProvider.ts`.
 */

import type { Bbox } from '../places/camera'
import { unwrappedToTint, type IndexedRing } from '../places/tint'

const RAD = Math.PI / 180
/** Shadow radius the backend uses (`orbit/eclipse.py`), so the cap edge meets its intervals. */
const SHADOW_RADIUS_M = 6_378_136.6
const WGS84_A = 6_378_137
const WGS84_E2 = 0.00669437999014
/** One vertex per degree of bearing keeps the straight map segments under a pixel off. */
const RING_STEPS = 360
/** A cap edge this close to a pole is pulled just short of it, where its longitude is defined. */
const POLE_MARGIN_DEG = 0.02

/**
 * Half-angle, seen from the geocenter, of the Earth's cylindrical shadow at geocentric
 * distance `radiusM`: a satellite is eclipsed while it is this close to the antisolar point.
 */
export function shadowHalfAngleDeg(radiusM: number): number {
  return Math.asin(Math.min(SHADOW_RADIUS_M / radiusM, 1)) / RAD
}

/**
 * Geodetic latitude of the point at a geocentric latitude and distance. The map places a
 * satellite at its geodetic latitude, up to 0.2° from the geocentric one in low orbit.
 */
export function geodeticLatDeg(geocentricLatDeg: number, radiusM: number): number {
  if (Math.abs(geocentricLatDeg) > 89.9) return geocentricLatDeg
  const p = radiusM * Math.cos(geocentricLatDeg * RAD)
  const z = radiusM * Math.sin(geocentricLatDeg * RAD)
  let lat = Math.atan2(z, p * (1 - WGS84_E2))
  for (let i = 0; i < 3; i++) {
    const normal = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2)
    const height = p / Math.cos(lat) - normal
    lat = Math.atan2(z, p * (1 - (WGS84_E2 * normal) / (normal + height)))
  }
  return lat / RAD
}

export interface Cap {
  centerLonDeg: number
  centerLatDeg: number
  /** Angular radius, at most 90°. */
  radiusDeg: number
  /**
   * Geocentric distance of the points on the cap edge. Given, the edge is a set of directions
   * from the geocenter and its latitudes are converted to geodetic ones; left out, the centre
   * and edge are surface normals, whose latitude is geodetic already.
   */
  radiusM?: number
}

/**
 * The cap as paintable geometry: `rings` to fill and `lines` to stroke along its edge.
 *
 * A cap that contains a pole has an edge that winds once around the map; its fill closes
 * along that pole. Both come back with copies a full turn away so a cap across the
 * antimeridian is painted on both sides.
 */
export function capTint(cap: Cap): { rings: IndexedRing[]; lines: IndexedRing[]; bbox: Bbox } {
  const lat0 = Math.min(Math.max(cap.centerLatDeg, -90), 90)
  let radius = Math.min(Math.max(cap.radiusDeg, 0), 90)
  const toPole = 90 - Math.abs(lat0)
  if (Math.abs(toPole - radius) < POLE_MARGIN_DEG) radius = Math.max(toPole - POLE_MARGIN_DEG, 0)
  if (radius <= 0) return { rings: [], lines: [], bbox: [0, 0, 0, 0] }
  const pole: 90 | -90 | null = toPole < radius ? (lat0 >= 0 ? 90 : -90) : null

  // Edge points at bearing θ from the centre, θ clockwise from north.
  const sinLat0 = Math.sin(lat0 * RAD)
  const cosLat0 = Math.cos(lat0 * RAD)
  const sinR = Math.sin(radius * RAD)
  const cosR = Math.cos(radius * RAD)
  const lons: number[] = []
  const lats: number[] = []
  for (let step = 0; step <= RING_STEPS; step++) {
    const bearing = (step / RING_STEPS) * 2 * Math.PI
    const sinLat = Math.min(Math.max(sinLat0 * cosR + cosLat0 * sinR * Math.cos(bearing), -1), 1)
    const lat = Math.asin(sinLat) / RAD
    const dLon = Math.atan2(Math.sin(bearing) * sinR * cosLat0, cosR - sinLat0 * sinLat) / RAD
    lons.push(cap.centerLonDeg + dLon)
    lats.push(cap.radiusM === undefined ? lat : geodeticLatDeg(lat, cap.radiusM))
  }

  // Unwrap the longitudes. An edge passing right by a pole makes one step jump nearly half a
  // turn, in an ambiguous direction; the total is known, so that step takes up the difference.
  // Clockwise bearings run westward round the north pole and eastward round the south one.
  const deltas = lons.slice(1).map((lon, i) => ((((lon - lons[i]!) % 360) + 540) % 360) - 180)
  const winding = deltas.reduce((a, b) => a + b, 0)
  const expected = pole === null ? 0 : -4 * pole
  if (Math.abs(winding - expected) > 180) {
    let widest = 0
    deltas.forEach((delta, i) => {
      if (Math.abs(delta) > Math.abs(deltas[widest]!)) widest = i
    })
    deltas[widest]! += expected - winding
  }
  const flat: number[] = [lons[0]!, lats[0]!]
  let lon = lons[0]!
  deltas.forEach((delta, i) => {
    lon += delta
    flat.push(lon, lats[i + 1]!)
  })
  return unwrappedToTint(flat, pole)
}
