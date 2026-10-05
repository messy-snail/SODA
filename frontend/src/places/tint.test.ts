import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  countryAt,
  indexShapes,
  overlaps,
  ringContains,
  ringToTint,
  tileBbox,
  type CountryShape,
} from './tint'

const shapes = indexShapes(
  JSON.parse(
    readFileSync(resolve(__dirname, '../../public/geo/country-shapes.json'), 'utf8'),
  ) as CountryShape[],
)

describe('tileBbox', () => {
  it('splits level 0 into a western and an eastern hemisphere', () => {
    expect(tileBbox(0, 0, 0)).toEqual([-180, -90, 0, 90])
    expect(tileBbox(1, 0, 0)).toEqual([0, -90, 180, 90])
  })

  it('halves each level, counting rows from the north', () => {
    expect(tileBbox(3, 0, 1)).toEqual([90, 0, 180, 90])
    expect(tileBbox(0, 1, 1)).toEqual([-180, -90, -90, 0])
  })
})

describe('overlaps', () => {
  it('includes touching edges and rejects gaps', () => {
    expect(overlaps([0, 0, 10, 10], [10, 10, 20, 20])).toBe(true)
    expect(overlaps([0, 0, 10, 10], [10.1, 0, 20, 10])).toBe(false)
  })
})

describe('ringContains', () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0]
  it('tests a point against a closed ring', () => {
    expect(ringContains(square, 5, 5)).toBe(true)
    expect(ringContains(square, 15, 5)).toBe(false)
  })
})

describe('countryAt', () => {
  const code = (lon: number, lat: number) => countryAt(shapes, lon, lat)?.iso2 ?? null

  it('finds the country under a point', () => {
    expect(code(126.98, 37.57)).toBe('KR') // Seoul
    expect(code(127.38, 36.35)).toBe('KR') // Daejeon
    expect(code(139.69, 35.69)).toBe('JP') // Tokyo
    expect(code(2.35, 48.86)).toBe('FR') // Paris
    expect(code(-104.99, 39.74)).toBe('US') // Denver
  })

  it('returns null at sea', () => {
    expect(code(-150, 0)).toBeNull()
    expect(code(130, 34.5)).toBeNull() // Korea Strait
  })

  it('respects holes: Lesotho is not South Africa', () => {
    expect(code(28.2, -29.6)).toBe('LS')
  })
})

/** A closed ring of `[lon, lat]` like the API's, wrapped into [-180, 180). */
function circle(lon: number, lat: number, radiusDeg: number, points = 64): number[][] {
  const out: number[][] = []
  const rad = Math.PI / 180
  for (let i = 0; i <= points; i++) {
    const bearing = (2 * Math.PI * i) / points
    const a = radiusDeg * rad
    const lat1 = lat * rad
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(a) + Math.cos(lat1) * Math.sin(a) * Math.cos(bearing),
    )
    const lon2 =
      lon * rad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(a) * Math.cos(lat1),
        Math.cos(a) - Math.sin(lat1) * Math.sin(lat2),
      )
    out.push([((((lon2 / rad + 540) % 360) + 360) % 360) - 180, lat2 / rad])
  }
  return out
}

describe('ringToTint', () => {
  const inside = (tint: ReturnType<typeof ringToTint>, lon: number, lat: number) =>
    tint.rings.some((r) => ringContains(r.ring, lon, lat))

  it('keeps an ordinary area as one ring', () => {
    const tint = ringToTint(circle(127.4, 36.4, 20))
    expect(tint.rings).toHaveLength(1)
    expect(inside(tint, 127.4, 36.4)).toBe(true)
    expect(inside(tint, 170, 36.4)).toBe(false)
  })

  it('paints both sides of the antimeridian', () => {
    const tint = ringToTint(circle(178, -18, 10))
    expect(tint.rings).toHaveLength(2)
    expect(inside(tint, 179.5, -18)).toBe(true)
    expect(inside(tint, -179.5, -18)).toBe(true)
    expect(inside(tint, 150, -18)).toBe(false)
  })

  it('closes an area around the pole along the pole, and strokes only the real edge', () => {
    // Svalbard with a 27 degree radius reaches over the North Pole.
    const tint = ringToTint(circle(15.4, 78.2, 27))
    expect(inside(tint, 0, 89)).toBe(true)
    expect(inside(tint, -165, 85)).toBe(true)
    expect(inside(tint, 15.4, 45)).toBe(false)
    for (const line of tint.lines) {
      const lats = line.ring.filter((_, i) => i % 2 === 1)
      expect(Math.max(...lats)).toBeLessThan(90)
    }
  })
})
