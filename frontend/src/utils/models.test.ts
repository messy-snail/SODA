import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../api/types'
import { formatBytes, modelFileProblem, resolveModel, sortModels } from './models'

function model(name: string): ModelInfo {
  return {
    name,
    norad_id: name === 'default' ? null : Number(name),
    size_bytes: 1,
    updated_at: '2026-09-17T00:00:00.000Z',
    settings: { heading_deg: 0, pitch_deg: 0, roll_deg: 0, scale: 1, minimum_size_px: 48 },
  }
}

describe('resolveModel', () => {
  it('prefers the satellite model over the shared default', () => {
    const models = [model('default'), model('25544')]
    expect(resolveModel(models, 25544)?.name).toBe('25544')
    expect(resolveModel(models, 43013)?.name).toBe('default')
    expect(resolveModel([model('25544')], 43013)).toBeNull()
  })
})

describe('sortModels', () => {
  it('puts the default first and orders by NORAD number', () => {
    const sorted = sortModels([model('40697'), model('default'), model('25544')])
    expect(sorted.map((item) => item.name)).toEqual(['default', '25544', '40697'])
  })
})

describe('modelFileProblem', () => {
  it('accepts GLB files within the size limit', () => {
    expect(modelFileProblem('Sat.GLB', 1000)).toBe('')
    expect(modelFileProblem('sat.gltf', 1000)).toContain('.glb')
    expect(modelFileProblem('sat.glb', 65 * 1024 * 1024)).toContain('64 MB')
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
