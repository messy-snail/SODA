/**
 * How one pass looks from its ground station: elevation, azimuth, range and range rate
 * over time, read off the pass's Earth-fixed track, so no request is needed. Pure, so it is
 * unit tested.
 *
 * The angles are geometric (no refraction) and the track is sampled about every 10 s, so
 * the values are for looking at a pass, not for pointing an antenna.
 */
import type { AzMaskPoint } from '../api/types'
import {
  stationFrame,
  type ContactGeometry,
  type StationFrame,
  type StationSite,
} from '../mission/linkWindow'

const RAD = Math.PI / 180
const LIGHT_KM_S = 299_792.458

export interface LookAngles {
  elevationDeg: number
  /** Clockwise from north, `[0, 360)`. */
  azimuthDeg: number
  rangeKm: number
}

export interface PassSample extends LookAngles {
  ms: number
  /** Positive while the satellite recedes. */
  rangeRateKmS: number
}

/** Direction and distance of an ITRS point seen from the site. */
export function lookAngles(frame: StationFrame, x: number, y: number, z: number): LookAngles {
  const dx = x - frame.position[0]
  const dy = y - frame.position[1]
  const dz = z - frame.position[2]
  const range = Math.hypot(dx, dy, dz)
  if (range === 0) return { elevationDeg: 90, azimuthDeg: 0, rangeKm: 0 }
  const east = dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2]
  const north = dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2]
  const up = dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2]
  return {
    elevationDeg: Math.asin(Math.min(1, Math.max(-1, up / range))) / RAD,
    azimuthDeg: (Math.atan2(east, north) / RAD + 360) % 360,
    rangeKm: range / 1000,
  }
}

/**
 * Derivative of evenly spaced values, fourth order wherever five samples fit.
 *
 * A second-order difference of 10 s range samples is off by tens of m/s around the peak of
 * an overhead pass, where the range curve bends hardest.
 */
export function derivative(values: readonly number[], step: number): number[] {
  const n = values.length
  if (n < 2 || step <= 0) return values.map(() => 0)
  const v = (i: number) => values[i]!
  if (n < 5) {
    return values.map((_, i) => {
      const a = Math.max(i - 1, 0)
      const b = Math.min(i + 1, n - 1)
      return (v(b) - v(a)) / ((b - a) * step)
    })
  }
  /** One-sided stencils for the two samples next to an edge; `s` is +1 at the start. */
  const edge = (i: number, s: 1 | -1, inner: boolean) =>
    (s *
      (inner
        ? -3 * v(i - s) - 10 * v(i) + 18 * v(i + s) - 6 * v(i + 2 * s) + v(i + 3 * s)
        : -25 * v(i) + 48 * v(i + s) - 36 * v(i + 2 * s) + 16 * v(i + 3 * s) - 3 * v(i + 4 * s))) /
    (12 * step)
  return values.map((_, i) => {
    if (i === 0) return edge(i, 1, false)
    if (i === 1) return edge(i, 1, true)
    if (i === n - 1) return edge(i, -1, false)
    if (i === n - 2) return edge(i, -1, true)
    return (-v(i + 2) + 8 * v(i + 1) - 8 * v(i - 1) + v(i - 2)) / (12 * step)
  })
}

/**
 * The pass sampled at its track points.
 *
 * Range does not depend on the frame, so its rate comes straight from the Earth-fixed track.
 *
 * @returns Empty when the pass has no track (SGP4 failed on it).
 */
export function passSamples(
  contact: Pick<ContactGeometry, 'aosMs' | 'losMs' | 'track'>,
  site: StationSite,
): PassSample[] {
  const count = Math.floor(contact.track.length / 3)
  if (count < 2 || contact.losMs <= contact.aosMs) return []
  const frame = stationFrame(site)
  const stepMs = (contact.losMs - contact.aosMs) / (count - 1)
  const looks = Array.from({ length: count }, (_, i) =>
    lookAngles(frame, contact.track[i * 3]!, contact.track[i * 3 + 1]!, contact.track[i * 3 + 2]!),
  )
  const rates = derivative(
    looks.map((look) => look.rangeKm),
    stepMs / 1000,
  )
  return looks.map((look, i) => ({
    ...look,
    ms: contact.aosMs + i * stepMs,
    rangeRateKmS: rates[i]!,
  }))
}

/** One-way Doppler shift of a carrier, positive while the satellite approaches. */
export function dopplerHz(rangeRateKmS: number, carrierHz: number): number {
  return (-rangeRateKmS / LIGHT_KM_S) * carrierHz
}

/**
 * Where a direction falls on a sky plot of radius one: zenith at the centre, the horizon on
 * the rim, north up and east to the right, with y growing downward as in SVG.
 */
export function skyPoint(azimuthDeg: number, elevationDeg: number): [number, number] {
  const radius = Math.min(1, Math.max(0, (90 - elevationDeg) / 90))
  return [radius * Math.sin(azimuthDeg * RAD), -radius * Math.cos(azimuthDeg * RAD)]
}

/**
 * Elevation a station requires at an azimuth: its minimum, or its horizon mask where that is
 * higher. Mirrors `HorizonMask.elevation_at`: linear between vertices, wrapping at 360.
 */
export function requiredElevationDeg(
  minElevDeg: number,
  mask: readonly AzMaskPoint[],
  azimuthDeg: number,
): number {
  if (mask.length < 2) return minElevDeg
  const sorted = [...mask].sort((a, b) => a.az_deg - b.az_deg)
  const az = ((azimuthDeg % 360) + 360) % 360
  const next = sorted.findIndex((point) => point.az_deg > az)
  const b = sorted[next < 0 ? 0 : next]!
  const a = sorted[(next < 0 ? sorted.length : next) - 1] ?? sorted[sorted.length - 1]!
  const width = (b.az_deg - a.az_deg + 360) % 360
  const along = (az - a.az_deg + 360) % 360
  const masked = a.min_elev_deg + (b.min_elev_deg - a.min_elev_deg) * (width ? along / width : 0)
  return Math.max(minElevDeg, masked)
}
