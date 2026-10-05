import type { Mesh } from './shapeMesh'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const FLOAT = 5126
const UNSIGNED_SHORT = 5123
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const LINEAR = 9729
const LINEAR_MIPMAP_LINEAR = 9987
const CLAMP_TO_EDGE = 33071

const padding = (length: number) => (4 - (length % 4)) % 4

function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

function bounds(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3
    min[axis] = Math.min(min[axis]!, positions[i]!)
    max[axis] = Math.max(max[axis]!, positions[i]!)
  }
  return { min, max }
}

/**
 * Pack a mesh, and optionally a PNG texture, into a self-contained glTF 2.0 binary.
 *
 * The material is a matte white PBR surface; without a texture the caller tints the model.
 */
export function buildGlb(mesh: Mesh, png?: Uint8Array): ArrayBuffer {
  const parts: Uint8Array[] = [
    bytesOf(mesh.positions),
    bytesOf(mesh.normals),
    bytesOf(mesh.uvs),
    bytesOf(mesh.indices),
    ...(png ? [png] : []),
  ]
  const bufferViews: Record<string, number>[] = []
  let offset = 0
  parts.forEach((part, index) => {
    const view: Record<string, number> = { buffer: 0, byteOffset: offset, byteLength: part.length }
    if (index < 3) view.target = ARRAY_BUFFER
    else if (index === 3) view.target = ELEMENT_ARRAY_BUFFER
    bufferViews.push(view)
    offset += part.length + padding(part.length)
  })
  const vertexCount = mesh.positions.length / 3
  const material: Record<string, unknown> = {
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 0.85,
      ...(png ? { baseColorTexture: { index: 0 } } : {}),
    },
  }
  const document = {
    asset: { version: '2.0', generator: 'SODA' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [material],
    ...(png
      ? {
          textures: [{ sampler: 0, source: 0 }],
          samplers: [
            {
              magFilter: LINEAR,
              minFilter: LINEAR_MIPMAP_LINEAR,
              wrapS: CLAMP_TO_EDGE,
              wrapT: CLAMP_TO_EDGE,
            },
          ],
          images: [{ bufferView: 4, mimeType: 'image/png' }],
        }
      : {}),
    accessors: [
      {
        bufferView: 0,
        componentType: FLOAT,
        count: vertexCount,
        type: 'VEC3',
        ...bounds(mesh.positions),
      },
      { bufferView: 1, componentType: FLOAT, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: FLOAT, count: vertexCount, type: 'VEC2' },
      {
        bufferView: 3,
        componentType: UNSIGNED_SHORT,
        count: mesh.indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews,
    buffers: [{ byteLength: offset }],
  }

  const json = new TextEncoder().encode(JSON.stringify(document))
  const jsonLength = json.length + padding(json.length)
  const total = 12 + 8 + jsonLength + 8 + offset
  const glb = new ArrayBuffer(total)
  const view = new DataView(glb)
  const bytes = new Uint8Array(glb)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, JSON_CHUNK, true)
  bytes.set(json, 20)
  bytes.fill(0x20, 20 + json.length, 20 + jsonLength)
  const binStart = 20 + jsonLength
  view.setUint32(binStart, offset, true)
  view.setUint32(binStart + 4, BIN_CHUNK, true)
  parts.forEach((part, index) => bytes.set(part, binStart + 8 + bufferViews[index]!.byteOffset!))
  return glb
}
