import { describe, expect, it } from 'vitest'
import { cubeMesh, sphereMesh, type Mesh } from './shapeMesh'

type Vec3 = [number, number, number]

function vertex(array: Float32Array, index: number): Vec3 {
  return [array[3 * index]!, array[3 * index + 1]!, array[3 * index + 2]!]
}

/** Signed area normals of every non-degenerate triangle, paired with its centroid. */
function triangles(mesh: Mesh) {
  const result: { normal: Vec3; centroid: Vec3 }[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(mesh.positions, mesh.indices[i + k]!))
    const ab = [b![0] - a![0], b![1] - a![1], b![2] - a![2]]
    const ac = [c![0] - a![0], c![1] - a![1], c![2] - a![2]]
    const normal: Vec3 = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    if (Math.hypot(...normal) < 1e-9) continue
    const centroid: Vec3 = [0, 1, 2].map((k) => (a![k]! + b![k]! + c![k]!) / 3) as Vec3
    result.push({ normal, centroid })
  }
  return result
}

function expectOutwardAndValid(mesh: Mesh, radius: number) {
  const count = mesh.positions.length / 3
  expect(mesh.normals.length).toBe(mesh.positions.length)
  expect(mesh.uvs.length).toBe(2 * count)
  expect(Math.max(...mesh.indices)).toBeLessThan(count)
  expect(Math.max(...mesh.positions.map(Math.abs))).toBeCloseTo(radius, 6)
  const faces = triangles(mesh)
  expect(faces.length).toBeGreaterThan(0)
  for (const { normal, centroid } of faces) {
    expect(
      normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2],
    ).toBeGreaterThan(0)
  }
}

describe('cubeMesh', () => {
  it('builds six outward, fully textured faces', () => {
    const mesh = cubeMesh()
    expect(mesh.positions.length / 3).toBe(24)
    expect(mesh.indices.length).toBe(36)
    expectOutwardAndValid(mesh, 0.5)
    expect(Math.min(...mesh.uvs)).toBe(0)
    expect(Math.max(...mesh.uvs)).toBe(1)
  })

  it('keeps side faces upright and unmirrored as seen from outside', () => {
    const mesh = cubeMesh()
    // The first face looks forward (+Z); from there +X is to the right and +Y is up.
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = vertex(mesh.positions, i)
      expect(z).toBe(0.5)
      expect(mesh.uvs[2 * i]).toBe(x + 0.5)
      expect(mesh.uvs[2 * i + 1]).toBe(0.5 - y)
    }
  })
})

describe('sphereMesh', () => {
  // Four lunes of (rings + 1) x (segments + 1) vertices.
  const RINGS = 6
  const SEGMENTS = 4
  const LUNE = (RINGS + 1) * (SEGMENTS + 1)

  it('builds an outward unit-diameter sphere', () => {
    const mesh = sphereMesh(RINGS, SEGMENTS)
    expect(mesh.positions.length / 3).toBe(4 * LUNE)
    expectOutwardAndValid(mesh, 0.5)
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      expect(Math.hypot(...vertex(mesh.positions, i))).toBeCloseTo(0.5, 6)
    }
  })

  it('centers an upright, unmirrored logo on the front, sides, and back', () => {
    const mesh = sphereMesh(RINGS, SEGMENTS)
    // Lune center axis and the direction a viewer on that axis sees as "right" (+Y up).
    const lunes: { axis: Vec3; right: Vec3 }[] = [
      { axis: [0, 0, 1], right: [1, 0, 0] },
      { axis: [1, 0, 0], right: [0, 0, -1] },
      { axis: [0, 0, -1], right: [-1, 0, 0] },
      { axis: [-1, 0, 0], right: [0, 0, 1] },
    ]
    const equator = RINGS / 2
    lunes.forEach(({ axis, right }, lune) => {
      const index = (ring: number, segment: number) => lune * LUNE + ring * (SEGMENTS + 1) + segment
      const center = index(equator, SEGMENTS / 2)
      vertex(mesh.positions, center).forEach((value, k) => expect(value).toBeCloseTo(axis[k]! / 2))
      expect(mesh.uvs[2 * center]).toBeCloseTo(0.5)
      expect(mesh.uvs[2 * center + 1]).toBeCloseTo(0.5)

      const beside = index(equator, SEGMENTS / 2 + 1)
      const [x, , z] = vertex(mesh.positions, beside)
      const towardRight = x * right[0] + z * right[2]
      expect(Math.sign(mesh.uvs[2 * beside]! - 0.5)).toBe(Math.sign(towardRight))

      const above = index(equator - 1, SEGMENTS / 2)
      expect(vertex(mesh.positions, above)[1]).toBeGreaterThan(0)
      expect(mesh.uvs[2 * above + 1]).toBeLessThan(0.5)
    })
  })
})
