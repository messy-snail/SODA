/**
 * Where the Sun is overhead, for drawing the night side and the Earth's shadow on the map.
 *
 * This is the low-precision formula of the Astronomical Almanac with Greenwich mean sidereal
 * time. It stays within 0.02° of the DE421 ephemeris the backend uses (checked for 2020-2035),
 * which is about a third of a second along a low orbit. It is for display only: every eclipse
 * time SODA reports comes from the backend.
 */

const J2000_UNIX_DAYS = 10957.5
const DAY_MS = 86_400_000
const RAD = Math.PI / 180

export interface SunSubpoint {
  /** East longitude in [-180, 180). */
  lon_deg: number
  lat_deg: number
}

/** Earth-fixed direction of the Sun at an epoch in ms (UTC), as the point it stands over. */
export function sunSubpoint(ms: number): SunSubpoint {
  const days = ms / DAY_MS - J2000_UNIX_DAYS
  const meanLongitude = 280.46 + 0.9856474 * days
  const anomaly = (357.528 + 0.9856003 * days) * RAD
  const longitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD
  const obliquity = (23.439 - 0.0000004 * days) * RAD
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude))
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(longitude))
  const siderealDeg = 280.46061837 + 360.98564736629 * days
  const lon = rightAscension / RAD - siderealDeg
  return { lon_deg: ((((lon + 180) % 360) + 360) % 360) - 180, lat_deg: declination / RAD }
}
