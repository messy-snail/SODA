import { describe, expect, it } from 'vitest'
import { containRect, logoFileProblem } from './logos'

describe('logoFileProblem', () => {
  it('accepts raster and SVG images by type or extension', () => {
    expect(logoFileProblem({ name: 'kari.png', type: 'image/png', size: 1000 })).toBe('')
    expect(logoFileProblem({ name: 'KARI.SVG', type: '', size: 1000 })).toBe('')
    expect(logoFileProblem({ name: 'logo', type: 'image/webp', size: 1000 })).toBe('')
  })

  it('rejects other formats and oversized files', () => {
    expect(logoFileProblem({ name: 'logo.gif', type: 'image/gif', size: 1000 })).toContain('PNG')
    expect(logoFileProblem({ name: 'model.glb', type: '', size: 1000 })).toContain('SVG')
    const huge = { name: 'logo.png', type: 'image/png', size: 11 * 1024 * 1024 }
    expect(logoFileProblem(huge)).toContain('10 MB')
  })
})

describe('containRect', () => {
  it('fits wide and tall images inside the padded square', () => {
    expect(containRect(200, 100, 512)).toEqual({ x: 0, y: 128, width: 512, height: 256 })
    expect(containRect(100, 400, 400, 0.1)).toEqual({ x: 160, y: 40, width: 80, height: 320 })
  })

  it('fills the padded square when the image has no intrinsic size', () => {
    expect(containRect(0, 0, 100, 0.25)).toEqual({ x: 25, y: 25, width: 50, height: 50 })
  })
})
