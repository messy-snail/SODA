import { describe, expect, it } from 'vitest'
import type { SensorSettings } from '../sensors/presets'
import { fovFromSwathKm, pointingDiffers, pointingFromSensor } from './sensorImport'

const sensor: SensorSettings = {
  mode: 'swath',
  swathKm: 120,
  fovDeg: 5,
  maxOffNadirDeg: 45,
  minSunElevDeg: 10,
}

describe('fovFromSwathKm', () => {
  it('is close to 2 atan(w / 2h) for a narrow swath', () => {
    const flat = (2 * Math.atan(60 / 500) * 180) / Math.PI
    expect(fovFromSwathKm(120, 500)).toBeCloseTo(flat, 1)
  })
})

describe('pointingFromSensor', () => {
  it('prefers the FOV of a computed swath', () => {
    expect(pointingFromSensor(sensor, 13.7, 500)).toEqual({ maxRollDeg: 45, fovDeg: 13.7 })
  })

  it('uses the FOV mode value, or turns a width into a FOV', () => {
    expect(pointingFromSensor({ ...sensor, mode: 'fov' }, null, 500).fovDeg).toBe(5)
    expect(pointingFromSensor(sensor, null, 500).fovDeg).toBeCloseTo(fovFromSwathKm(120, 500), 2)
  })
})

describe('pointingDiffers', () => {
  const pointing = { maxRollDeg: 30, fovDeg: 0.687, minSunElevDeg: 10 }

  it('ignores rounding and catches any of the three numbers', () => {
    expect(pointingDiffers(pointing, { ...pointing, fovDeg: 0.6874 })).toBe(false)
    expect(pointingDiffers(pointing, { ...pointing, fovDeg: 0 })).toBe(true)
    expect(pointingDiffers(pointing, { ...pointing, maxRollDeg: 20 })).toBe(true)
    expect(pointingDiffers(pointing, { ...pointing, minSunElevDeg: -90 })).toBe(true)
    // A half-typed field is a difference too.
    expect(pointingDiffers(pointing, { ...pointing, maxRollDeg: Number.NaN })).toBe(true)
  })
})
