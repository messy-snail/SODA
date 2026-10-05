import { describe, expect, it } from 'vitest'
import {
  blocksNearest,
  chunkSize,
  hiddenByEllipsoid,
  nearestIndex,
  nearestOnPolyline,
  stripRings,
  subdivisions,
  validRanges,
} from './geometry'

describe('validRanges', () => {
  it('splits around invalid samples and drops single points', () => {
    expect(validRanges(10, [])).toEqual([[0, 9]])
    expect(validRanges(10, [3, 4, 6])).toEqual([
      [0, 2],
      [7, 9],
    ])
    expect(validRanges(3, [0, 2])).toEqual([])
  })
})

describe('stripRings', () => {
  const left = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0]
  const right = [0, 1, 1, 1, 2, 1, 3, 1, 4, 1]

  it('builds closed rings that share boundary samples', () => {
    const rings = stripRings(left, right, 2)
    expect(rings).toEqual([
      [0, 0, 1, 0, 2, 0, 2, 1, 1, 1, 0, 1],
      [2, 0, 3, 0, 4, 0, 4, 1, 3, 1, 2, 1],
    ])
  })

  it('keeps a short tail chunk', () => {
    const rings = stripRings(left, right, 3)
    expect(rings).toHaveLength(2)
    expect(rings[1]).toEqual([3, 0, 4, 0, 4, 1, 3, 1])
  })
})

describe('chunkSize and nearestIndex', () => {
  it('targets a time span per polygon', () => {
    expect(chunkSize(30)).toBe(8)
    expect(chunkSize(600)).toBe(2)
  })

  it('finds the nearest finite point', () => {
    expect(nearestIndex([0, 10, NaN, 5], [0, 10, 0, 4], 6, 5)).toBe(3)
  })
})

describe('nearestOnPolyline', () => {
  it('lands between two vertices, not on one of them', () => {
    expect(nearestOnPolyline([0, 10, 20], [0, 0, 0], 13, 4)).toEqual({ index: 1, fraction: 0.3 })
    // Past the end of the line it stops at the last vertex.
    expect(nearestOnPolyline([0, 10], [0, 0], 25, 0)).toEqual({ index: 0, fraction: 1 })
  })

  it('skips segments with a hidden end', () => {
    // The vertex at x = 10 is hidden, so both segments next to the click are out.
    const hit = nearestOnPolyline([0, NaN, 20, 30], [0, NaN, 0, 0], 10, 0)
    expect(hit).toEqual({ index: 2, fraction: 0 })
  })

  it('falls back to a single visible vertex, and to null with none', () => {
    expect(nearestOnPolyline([NaN, 5, NaN], [NaN, 5, NaN], 0, 0)).toEqual({ index: 1, fraction: 0 })
    expect(nearestOnPolyline([NaN, NaN], [NaN, NaN], 0, 0)).toBeNull()
    expect(nearestOnPolyline([], [], 0, 0)).toBeNull()
  })
})

describe('subdivisions', () => {
  it('cuts a chord so no piece is longer than the limit', () => {
    expect(subdivisions(230_000)).toBe(5)
    expect(subdivisions(50_000)).toBe(1)
    expect(subdivisions(0)).toBe(1)
    expect(subdivisions(Number.NaN)).toBe(1)
  })
})

describe('blocksNearest', () => {
  const spans = [
    { i0: 0, i1: 90 },
    { i0: 90, i1: 190 },
    { i0: 190, i1: 290 },
    { i0: 290, i1: 300 },
  ]

  it('groups spans by where their middle falls', () => {
    expect(blocksNearest(spans, 200, 0)).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it('starts with the block around the clock and works outwards', () => {
    expect(blocksNearest(spans, 100, 250)).toEqual([[2, 3], [1], [0]])
    expect(blocksNearest(spans, 100, -1000)).toEqual([[0], [1], [2, 3]])
  })
})

describe('hiddenByEllipsoid', () => {
  const radii = { x: 1, y: 1, z: 1 }
  const camera = { x: 3, y: 0, z: 0 }

  it('hides what is behind the globe and shows what is in front or beside it', () => {
    expect(hiddenByEllipsoid(camera, { x: 1.1, y: 0, z: 0 }, radii)).toBe(false)
    expect(hiddenByEllipsoid(camera, { x: -1.1, y: 0, z: 0 }, radii)).toBe(true)
    // Far off to the side the line of sight clears the limb, even beyond the centre.
    expect(hiddenByEllipsoid(camera, { x: -1, y: 5, z: 0 }, radii)).toBe(false)
    // Just past the limb, close to the surface.
    expect(hiddenByEllipsoid(camera, { x: 0, y: 1.05, z: 0 }, radii)).toBe(true)
    expect(hiddenByEllipsoid(camera, { x: 0.5, y: 1.05, z: 0 }, radii)).toBe(false)
  })

  it('scales with the ellipsoid, and hides nothing from inside it', () => {
    const earth = { x: 6378137, y: 6378137, z: 6356752 }
    const above = { x: 0, y: 0, z: 2e7 }
    expect(hiddenByEllipsoid(above, { x: 0, y: 0, z: -6.8e6 }, earth)).toBe(true)
    expect(hiddenByEllipsoid(above, { x: 0, y: 0, z: 6.8e6 }, earth)).toBe(false)
    expect(hiddenByEllipsoid({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -6.8e6 }, earth)).toBe(false)
  })
})
