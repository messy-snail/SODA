import { describe, expect, it } from 'vitest'
import { displacementMap, filterMarkup } from './refraction'

const at = (map: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4
  return [map[i]! - 128, map[i + 1]! - 128]
}

describe('displacementMap', () => {
  const width = 100
  const height = 60
  const map = displacementMap(width, height, { radius: 12, bezel: 10 })

  it('leaves the flat middle alone', () => {
    expect(at(map, width, 50, 30)).toEqual([0, 0])
    expect(at(map, width, 20, 30)).toEqual([0, 0])
  })

  it('pulls the backdrop inward at each straight edge', () => {
    expect(at(map, width, 0, 30)[0]).toBeGreaterThan(100) // left rim samples to the right
    expect(at(map, width, width - 1, 30)[0]).toBeLessThan(-100)
    expect(at(map, width, 50, 0)[1]).toBeGreaterThan(100)
    expect(at(map, width, 50, height - 1)[1]).toBeLessThan(-100)
  })

  it('bends diagonally in the corners and fades across the rim', () => {
    const [dx, dy] = at(map, width, 4, 4)
    expect(dx).toBeGreaterThan(0)
    expect(dy).toBeGreaterThan(0)
    expect(Math.abs(at(map, width, 5, 30)[0]!)).toBeLessThan(Math.abs(at(map, width, 1, 30)[0]!))
  })

  it('keeps square corners straight for a frame pane (radius 0)', () => {
    const square = displacementMap(width, height, { radius: 0, bezel: 10 })
    // Along an edge next to the corner, only that edge's axis bends.
    expect(at(square, width, 0, 5)[0]).toBeGreaterThan(100)
    expect(at(square, width, 0, 5)[1]).toBe(0)
    expect(at(square, width, 5, 0)[0]).toBe(0)
    expect(at(square, width, 5, 0)[1]).toBeGreaterThan(100)
    expect(at(square, width, 50, 30)).toEqual([0, 0])
  })
})

describe('filterMarkup', () => {
  it('sizes the filter to the pane and splits the channels', () => {
    const markup = filterMarkup('lg-1', 320.4, 80, 'data:x', {
      blur: 12,
      scale: 40,
      dispersion: 0.1,
      saturate: 1.6,
      slope: 0.8,
      intercept: 0.2,
    })
    expect(markup).toContain('id="lg-1"')
    expect(markup).toContain('width="320" height="80"')
    expect(markup.match(/<feDisplacementMap/g)).toHaveLength(3)
    expect(markup).toContain('scale="44.0"')
    expect(markup).toContain('scale="36.0"')
    expect(markup).toContain('slope="0.8" intercept="0.2"')
  })
})
