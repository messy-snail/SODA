import type { SensorSettings } from '../sensors/presets'

/** Mean Earth radius; matches `MEAN_RADIUS_M` in `orbit/swath.py`. */
const MEAN_RADIUS_KM = 6371.0088

/** Full FOV that images `swathKm` at nadir from `altitudeKm` (sphere), as the backend does. */
export function fovFromSwathKm(swathKm: number, altitudeKm: number): number {
  const half = swathKm / 2 / MEAN_RADIUS_KM
  const ratio = (MEAN_RADIUS_KM + altitudeKm) / MEAN_RADIUS_KM
  return (2 * Math.atan2(Math.sin(half), ratio - Math.cos(half)) * 180) / Math.PI
}

/**
 * The imaging tab's roll limit and FOV taken from the swath tool's sensor, so the search
 * matches the field of regard drawn on the globe. A computed swath already knows its FOV;
 * otherwise a width in km is turned into one at the run's mean altitude.
 */
export function pointingFromSensor(
  sensor: SensorSettings,
  swathFovDeg: number | null,
  meanAltitudeKm: number,
): { maxRollDeg: number; fovDeg: number } {
  const fov =
    swathFovDeg ??
    (sensor.mode === 'fov' ? sensor.fovDeg : fovFromSwathKm(sensor.swathKm, meanAltitudeKm))
  return { maxRollDeg: sensor.maxOffNadirDeg, fovDeg: Math.round(fov * 1000) / 1000 }
}

/** The three numbers the imaging search and the swath's sensor have in common. */
export interface SensorPointing {
  maxRollDeg: number
  fovDeg: number
  minSunElevDeg: number
}

/** Whether two sets differ by more than the rounding of an imported FOV. */
export function pointingDiffers(a: SensorPointing, b: SensorPointing): boolean {
  const off = (x: number, y: number) => !(Math.abs(x - y) <= 1e-3)
  return (
    off(a.maxRollDeg, b.maxRollDeg) ||
    off(a.fovDeg, b.fovDeg) ||
    off(a.minSunElevDeg, b.minSunElevDeg)
  )
}
