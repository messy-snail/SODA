/**
 * When a ground contact can carry data: the part of a pass above a minimum elevation, less
 * the time the link takes to lock. The elevation comes from the pass's Earth-fixed track, so
 * no request is needed. Pure, so it is unit tested.
 */
import type { TimeSpan } from '../utils/levelChart'

const WGS84_A_M = 6378137
const WGS84_E2 = 6.69437999014e-3
const RAD = Math.PI / 180

export type Vec3 = readonly [number, number, number]

export interface StationSite {
  lat_deg: number
  lon_deg: number
  alt_m: number
}

/** A site on the WGS84 ellipsoid: its ITRS position in metres and its local east, north, up. */
export interface StationFrame {
  position: Vec3
  east: Vec3
  north: Vec3
  up: Vec3
}

export function stationFrame(site: StationSite): StationFrame {
  const lat = site.lat_deg * RAD
  const lon = site.lon_deg * RAD
  const up: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
  const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2)
  return {
    position: [
      (n + site.alt_m) * up[0],
      (n + site.alt_m) * up[1],
      (n * (1 - WGS84_E2) + site.alt_m) * up[2],
    ],
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    up,
  }
}

/** Elevation of an ITRS point above the site's geodetic horizon. */
export function elevationDeg(frame: StationFrame, x: number, y: number, z: number): number {
  const dx = x - frame.position[0]
  const dy = y - frame.position[1]
  const dz = z - frame.position[2]
  const range = Math.hypot(dx, dy, dz)
  if (range === 0) return 90
  const sine = (dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2]) / range
  return Math.asin(Math.min(1, Math.max(-1, sine))) / RAD
}

/** What `elevationSpan` reads of a pass. */
export interface ContactGeometry {
  aosMs: number
  losMs: number
  maxElevationDeg: number
  /** `Pass.track_fixed_m`: flat ITRS metres, sampled evenly from AOS to LOS. */
  track: readonly number[]
}

/**
 * The stretch of a pass at or above `minElevDeg`, from the first rise through it to the
 * last fall through it.
 *
 * The crossings are interpolated linearly between track samples, which are 10 s apart for
 * an ordinary pass, so an edge is good to about a second.
 *
 * @param siteMinElevDeg Elevation the pass was predicted with; a threshold at or below it
 *   keeps the whole pass, since AOS and LOS already respect it.
 * @returns Null when the pass never gets that high.
 */
export function elevationSpan(
  contact: ContactGeometry,
  site: StationSite,
  siteMinElevDeg: number,
  minElevDeg: number,
): TimeSpan | null {
  const whole = { startMs: contact.aosMs, endMs: contact.losMs }
  if (contact.losMs <= contact.aosMs) return null
  if (minElevDeg <= siteMinElevDeg) return whole
  if (contact.maxElevationDeg < minElevDeg) return null
  const count = Math.floor(contact.track.length / 3)
  // Without a track (SGP4 failed on it) the peak is all there is to go by.
  if (count < 2) return whole

  const frame = stationFrame(site)
  const stepMs = (contact.losMs - contact.aosMs) / (count - 1)
  const elevations = Array.from({ length: count }, (_, i) =>
    elevationDeg(
      frame,
      contact.track[i * 3]!,
      contact.track[i * 3 + 1]!,
      contact.track[i * 3 + 2]!,
    ),
  )
  const first = elevations.findIndex((value) => value >= minElevDeg)
  if (first < 0) return null
  let last = count - 1
  while (elevations[last]! < minElevDeg) last--
  /** Time between sample `below` and its neighbour `above` at which the threshold is met. */
  const crossing = (below: number, above: number) => {
    const fraction = (minElevDeg - elevations[below]!) / (elevations[above]! - elevations[below]!)
    return contact.aosMs + (below + (above - below) * fraction) * stepMs
  }
  return {
    startMs: first === 0 ? contact.aosMs : crossing(first - 1, first),
    endMs: last === count - 1 ? contact.losMs : crossing(last + 1, last),
  }
}

/**
 * What is left of a gate once the link has locked, kept inside `[fromMs, toMs]`.
 *
 * @returns Null when the lock takes the whole gate.
 */
export function usableWindow(
  gate: TimeSpan | null,
  lockS: number,
  fromMs: number,
  toMs: number,
): TimeSpan | null {
  if (!gate) return null
  const startMs = Math.max(gate.startMs + lockS * 1000, fromMs)
  const endMs = Math.min(gate.endMs, toMs)
  return endMs > startMs ? { startMs, endMs } : null
}
