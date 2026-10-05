import { describe, expect, it } from 'vitest'
import { buildGlb } from './glb'
import { cubeMesh } from './shapeMesh'

interface Parsed {
  version: number
  length: number
  json: {
    accessors: { bufferView: number; count: number; min?: number[]; max?: number[] }[]
    bufferViews: { byteOffset: number; byteLength: number }[]
    buffers: { byteLength: number }[]
    images?: { bufferView: number; mimeType: string }[]
    materials: { pbrMetallicRoughness: { baseColorTexture?: { index: number } } }[]
  }
  bin: Uint8Array
  chunkLengths: number[]
}

function parse(glb: ArrayBuffer): Parsed {
  const view = new DataView(glb)
  expect(view.getUint32(0, true)).toBe(0x46546c67)
  const jsonLength = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a)
  const text = new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))
  const binStart = 20 + jsonLength
  const binLength = view.getUint32(binStart, true)
  expect(view.getUint32(binStart + 4, true)).toBe(0x004e4942)
  return {
    version: view.getUint32(4, true),
    length: view.getUint32(8, true),
    json: JSON.parse(text),
    bin: new Uint8Array(glb, binStart + 8, binLength),
    chunkLengths: [jsonLength, binLength],
  }
}

describe('buildGlb', () => {
  it('packs an untextured mesh into an aligned glTF 2.0 binary', () => {
    const mesh = cubeMesh()
    const glb = buildGlb(mesh)
    const parsed = parse(glb)
    expect(parsed.version).toBe(2)
    expect(parsed.length).toBe(glb.byteLength)
    expect(parsed.chunkLengths.every((length) => length % 4 === 0)).toBe(true)
    expect(parsed.json.accessors.map((accessor) => accessor.count)).toEqual([24, 24, 24, 36])
    expect(parsed.json.accessors[0]).toMatchObject({
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    })
    expect(parsed.json.images).toBeUndefined()
    expect(parsed.json.materials[0]!.pbrMetallicRoughness.baseColorTexture).toBeUndefined()
    expect(parsed.json.buffers[0]!.byteLength).toBe(parsed.bin.length)

    const indices = parsed.json.bufferViews[3]!
    const copy = new Uint16Array(
      parsed.bin.slice(indices.byteOffset, indices.byteOffset + indices.byteLength).buffer,
    )
    expect([...copy]).toEqual([...mesh.indices])
  })

  it('embeds the PNG texture in the binary chunk', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const parsed = parse(buildGlb(cubeMesh(), png))
    expect(parsed.json.images).toEqual([{ bufferView: 4, mimeType: 'image/png' }])
    expect(parsed.json.materials[0]!.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 })
    const image = parsed.json.bufferViews[4]!
    expect(image.byteOffset % 4).toBe(0)
    expect([...parsed.bin.slice(image.byteOffset, image.byteOffset + image.byteLength)]).toEqual([
      ...png,
    ])
    for (const view of parsed.json.bufferViews) {
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(parsed.bin.length)
    }
  })
})
