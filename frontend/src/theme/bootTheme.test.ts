import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import { activePreset } from './presets'

describe('index.html boot splash', () => {
  it('starts dark, like the only theme', () => {
    expect(activePreset.dark).toBe(true)
    expect(html).toContain('<html lang="ko" data-theme="dark">')
  })

  it('paints the splash with the theme background', () => {
    expect(html).toContain(`background: ${activePreset.colors.background}`)
    expect(html).toContain(`name="theme-color" content="${activePreset.colors.background}"`)
  })
})
