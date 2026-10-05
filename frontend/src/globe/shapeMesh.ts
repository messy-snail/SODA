/**
 * Unit-size cube and sphere meshes in glTF axes: +Y is up (zenith) and +Z is forward (along
 * track), so Cesium's glTF conversion lines them up with `orbitalOrientation`.
 */

export interface Mesh {
  positions: Float32Array
  normals: Float32Array
  /** glTF texture coordinates: (0, 0) is the image's top-left corner. */
  uvs: Float32Array
  indices: Uint16Array
}

type Vec3 = readonly [number, number, number]

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]

/** Right-hand direction of an image seen from outside a face with outward `normal`. */
const rightOf = (normal: Vec3, up: Vec3) => cross(scale(normal, -1), up)

class MeshBuilder {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
  indices: number[] = []

  vertex(position: Vec3, normal: Vec3, u: number, v: number) {
    this.positions.push(...position)
    this.normals.push(...normal)
    this.uvs.push(u, v)
    return this.positions.length / 3 - 1
  }

  build(): Mesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint16Array(this.indices),
    }
  }
}

const CUBE_FACES: { normal: Vec3; up: Vec3 }[] = [
  { normal: [0, 0, 1], up: [0, 1, 0] },
  { normal: [0, 0, -1], up: [0, 1, 0] },
  { normal: [1, 0, 0], up: [0, 1, 0] },
  { normal: [-1, 0, 0], up: [0, 1, 0] },
  { normal: [0, 1, 0], up: [0, 0, 1] },
  { normal: [0, -1, 0], up: [0, 0, 1] },
]

/** A cube with a 1 m edge whose six faces each show the whole texture upright. */
export function cubeMesh(): Mesh {
  const mesh = new MeshBuilder()
  for (const { normal, up } of CUBE_FACES) {
    const right = rightOf(normal, up)
    const first = mesh.positions.length / 3
    // Bottom-left, bottom-right, top-right, top-left as seen from outside: counter-clockwise.
    for (const [s, t] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const position: Vec3 = [
        0.5 * (normal[0] + s * right[0] + t * up[0]),
        0.5 * (normal[1] + s * right[1] + t * up[1]),
        0.5 * (normal[2] + s * right[2] + t * up[2]),
      ]
      mesh.vertex(position, normal, (s + 1) / 2, (1 - t) / 2)
    }
    mesh.indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
  }
  return mesh.build()
}

/** Share of the sphere diameter covered by the logo's diagonal on each side. */
const SPHERE_LOGO_SPAN = 0.8
/** Centers of the four lunes: forward (+Z), right-hand +X, backward, and -X. */
const LUNE_CENTERS = [0, 0.5, 1, 1.5].map((turns) => turns * Math.PI)

/**
 * A sphere with a 1 m diameter showing the texture upright on four sides, like the cube.
 *
 * The sphere is split into four pole-to-pole lunes around +Y. Each lune projects the texture
 * along its center axis, so the logo reads correctly from the front, back, and either side.
 * Texture coordinates beyond the logo clamp to the texture's (background) border.
 */
export function sphereMesh(rings = 16, segments = 8): Mesh {
  const mesh = new MeshBuilder()
  const half = (SPHERE_LOGO_SPAN * 0.5) / Math.SQRT2
  const up: Vec3 = [0, 1, 0]
  for (const center of LUNE_CENTERS) {
    const right = rightOf([Math.sin(center), 0, Math.cos(center)], up)
    const first = mesh.positions.length / 3
    for (let ring = 0; ring <= rings; ring++) {
      const polar = (ring / rings) * Math.PI
      for (let segment = 0; segment <= segments; segment++) {
        const azimuth = center + (segment / segments - 0.5) * (Math.PI / 2)
        const normal: Vec3 = [
          Math.sin(polar) * Math.sin(azimuth),
          Math.cos(polar),
          Math.sin(polar) * Math.cos(azimuth),
        ]
        const position = scale(normal, 0.5)
        const u = 0.5 + dot(position, right) / (2 * half)
        const v = 0.5 - dot(position, up) / (2 * half)
        mesh.vertex(position, normal, u, v)
      }
    }
    const row = segments + 1
    for (let ring = 0; ring < rings; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = first + ring * row + segment
        const b = a + row
        mesh.indices.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }
  return mesh.build()
}
