/**
 * Cross-track look geometry for a pushbroom sensor, mirroring `src/soda/orbit/swath.py`.
 *
 * The sensor looks along geodetic nadir rotated about the along-track axis by `±angle`, and each
 * look ray is intersected with the WGS84 ellipsoid. Rays beyond the limb are clamped just inside
 * the horizon, like the backend, so the fan always lands on the ground.
 */

export type Vec3 = [number, number, number]

export const WGS84_A = 6_378_137.0
const WGS84_F = 1 / 298.257223563
export const WGS84_B = WGS84_A * (1 - WGS84_F)
const HORIZON_MARGIN_RAD = (0.2 * Math.PI) / 180

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec3) => Math.sqrt(dot(a, a))
const unit = (a: Vec3): Vec3 => {
  const n = norm(a)
  return [a[0] / n, a[1] / n, a[2] / n]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Geocentric radius of the WGS84 ellipsoid at a geodetic latitude. */
export function ellipsoidRadius(latRad: number): number {
  const aCos = WGS84_A * Math.cos(latRad)
  const bSin = WGS84_B * Math.sin(latRad)
  return Math.sqrt(((WGS84_A * aCos) ** 2 + (WGS84_B * bSin) ** 2) / (aCos ** 2 + bSin ** 2))
}

/** Nearest ray-ellipsoid hit; a ray that misses returns its closest approach. */
export function intersectEllipsoid(origin: Vec3, direction: Vec3): Vec3 {
  const s: Vec3 = [1 / WGS84_A, 1 / WGS84_A, 1 / WGS84_B]
  const p: Vec3 = [origin[0] * s[0], origin[1] * s[1], origin[2] * s[2]]
  const d: Vec3 = [direction[0] * s[0], direction[1] * s[1], direction[2] * s[2]]
  const qa = dot(d, d)
  const qb = 2 * dot(p, d)
  const qc = dot(p, p) - 1
  const disc = Math.max(qb * qb - 4 * qa * qc, 0)
  const distance = (-qb - Math.sqrt(disc)) / (2 * qa)
  return [
    origin[0] + distance * direction[0],
    origin[1] + distance * direction[1],
    origin[2] + distance * direction[2],
  ]
}

/**
 * Left and right ground points (ECEF metres) for a symmetric cross-track look angle.
 *
 * @param position Satellite position, Earth-fixed metres.
 * @param velocity Satellite velocity in the same Earth-fixed frame, m/s.
 * @param latRad Geodetic latitude of the satellite.
 * @param lonRad Longitude of the satellite.
 * @param angleRad Cross-track angle from nadir (half the FOV for the swath).
 */
export function crossTrackEdges(
  position: Vec3,
  velocity: Vec3,
  latRad: number,
  lonRad: number,
  angleRad: number,
): { left: Vec3; right: Vec3 } {
  const up: Vec3 = [
    Math.cos(latRad) * Math.cos(lonRad),
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad),
  ]
  const nadir: Vec3 = [-up[0], -up[1], -up[2]]
  const vn = dot(velocity, nadir)
  const along = unit([
    velocity[0] - vn * nadir[0],
    velocity[1] - vn * nadir[1],
    velocity[2] - vn * nadir[2],
  ])
  const right = unit(cross(along, up))
  const horizon = Math.asin(Math.min(Math.max(ellipsoidRadius(latRad) / norm(position), 0), 1))
  const angle = Math.min(angleRad, horizon - HORIZON_MARGIN_RAD)
  const [c, sn] = [Math.cos(angle), Math.sin(angle)]
  const look = (sign: number): Vec3 => [
    c * nadir[0] + sign * sn * right[0],
    c * nadir[1] + sign * sn * right[1],
    c * nadir[2] + sign * sn * right[2],
  ]
  return {
    left: intersectEllipsoid(position, look(-1)),
    right: intersectEllipsoid(position, look(1)),
  }
}
