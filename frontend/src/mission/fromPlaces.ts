import { CITY_HEIGHT_M, pointForBbox, type Bbox } from '../places/camera'
import type { PinIcon } from '../places/pinIcons'
import {
  MAX_TARGET_NAME,
  targetCenter,
  type BoxTarget,
  type ImagingTarget,
  type PointTarget,
} from './targets'

/**
 * Copies between the places tool's pins and search results and the imaging targets. They
 * are copies: nothing links a target to the pin it came from, so each can change or be
 * deleted on its own. "Same place" is what tells whether one was already made.
 */

/** Form values keep 5 decimals, so two places within that are the same one. */
const SAME_DEG = 1e-5
const same = (a: number, b: number) => Math.abs(a - b) < SAME_DEG

type LatLon = { lat_deg: number; lon_deg: number }
type Box = Pick<BoxTarget, 'west_deg' | 'south_deg' | 'east_deg' | 'north_deg'>

/** What a place would become as a target: a point, or a box for an extent. */
export type TargetCandidate =
  ({ kind: 'point'; name: string } & LatLon) | ({ kind: 'box'; name: string } & Box)

/** A pin or place name cut to what a target name may hold. */
export function targetName(name: string): string {
  return name.trim().slice(0, MAX_TARGET_NAME)
}

/** A camera extent `[west, south, east, north]` as the edges of a box target. */
export function boxFromBbox([west, south, east, north]: Bbox): Box {
  return { west_deg: west, south_deg: south, east_deg: east, north_deg: north }
}

/** The target already at the candidate's place, if there is one. */
export function findTarget(
  targets: readonly ImagingTarget[],
  candidate: TargetCandidate,
): ImagingTarget | undefined {
  if (candidate.kind === 'point') {
    return targets.find(
      (target): target is PointTarget =>
        target.kind === 'point' &&
        same(target.lat_deg, candidate.lat_deg) &&
        same(target.lon_deg, candidate.lon_deg),
    )
  }
  return targets.find(
    (target): target is BoxTarget =>
      target.kind === 'box' &&
      same(target.west_deg, candidate.west_deg) &&
      same(target.south_deg, candidate.south_deg) &&
      same(target.east_deg, candidate.east_deg) &&
      same(target.north_deg, candidate.north_deg),
  )
}

/** The pin at a point (a box target's pin sits at its centre), if there is one. */
export function findPinAt<T extends LatLon>(pins: readonly T[], point: LatLon): T | undefined {
  return pins.find((pin) => same(pin.lat_deg, point.lat_deg) && same(pin.lon_deg, point.lon_deg))
}

/**
 * A target as a new pin: at the point, or at a box's centre from a height that shows the
 * whole box. It takes the imaging-target icon and the next automatic colour.
 */
export function pinFromTarget(target: ImagingTarget): {
  name: string
  icon: PinIcon
  colorIndex: null
  lat_deg: number
  lon_deg: number
  height_m: number
} {
  const center = targetCenter(target)
  const height_m =
    target.kind === 'point'
      ? CITY_HEIGHT_M
      : pointForBbox([target.west_deg, target.south_deg, target.east_deg, target.north_deg])
          .height_m
  return { name: target.name, icon: 'target', colorIndex: null, ...center, height_m }
}
