import { describe, expect, it } from 'vitest'
import { boxFromBbox, findPinAt, findTarget, pinFromTarget, targetName } from './fromPlaces'
import { MAX_TARGET_NAME, type ImagingTarget } from './targets'

const point: ImagingTarget = {
  kind: 'point',
  id: 'p',
  name: 'Daejeon',
  lat_deg: 36.35,
  lon_deg: 127.38,
}
const box: ImagingTarget = {
  kind: 'box',
  id: 'b',
  name: 'South Korea',
  west_deg: 126.16,
  south_deg: 34.31,
  east_deg: 129.57,
  north_deg: 38.62,
}

describe('places as imaging targets', () => {
  it('cuts a pin name to the target name length', () => {
    expect(targetName(`  ${'x'.repeat(60)} `)).toHaveLength(MAX_TARGET_NAME)
    expect(targetName(' Seoul ')).toBe('Seoul')
  })

  it('turns a country extent into box edges', () => {
    expect(boxFromBbox([126.16, 34.31, 129.57, 38.62])).toEqual({
      west_deg: 126.16,
      south_deg: 34.31,
      east_deg: 129.57,
      north_deg: 38.62,
    })
  })

  it('finds the target already at a place, by kind', () => {
    const targets = [point, box]
    expect(
      findTarget(targets, { kind: 'point', name: '', lat_deg: 36.350004, lon_deg: 127.38 }),
    ).toBe(point)
    expect(
      findTarget(targets, { kind: 'point', name: '', lat_deg: 36.36, lon_deg: 127.38 }),
    ).toBeUndefined()
    expect(
      findTarget(targets, {
        kind: 'box',
        name: '',
        ...boxFromBbox([126.16, 34.31, 129.57, 38.62]),
      }),
    ).toBe(box)
    // A point at a box's corner is not that box.
    expect(
      findTarget([box], { kind: 'point', name: '', lat_deg: 34.31, lon_deg: 126.16 }),
    ).toBeUndefined()
  })
})

describe('imaging targets as pins', () => {
  it('pins a point where it is', () => {
    expect(pinFromTarget(point)).toEqual({
      name: 'Daejeon',
      icon: 'target',
      colorIndex: null,
      lat_deg: 36.35,
      lon_deg: 127.38,
      height_m: 400_000,
    })
  })

  it('pins a box at its centre, high enough to show it', () => {
    const pin = pinFromTarget(box)
    expect(pin.lat_deg).toBeCloseTo(36.465)
    expect(pin.lon_deg).toBeCloseTo(127.865)
    expect(pin.height_m).toBeGreaterThan(400_000)
  })

  it('centres a box across the date line on the far side', () => {
    const pin = pinFromTarget({ ...box, west_deg: 170, east_deg: -170 })
    expect(Math.abs(pin.lon_deg)).toBeCloseTo(180)
  })

  it('finds the pin at a target', () => {
    const pins = [{ id: 'a', lat_deg: 36.35, lon_deg: 127.38 }]
    expect(findPinAt(pins, pinFromTarget(point))?.id).toBe('a')
    expect(findPinAt(pins, pinFromTarget(box))).toBeUndefined()
  })
})
