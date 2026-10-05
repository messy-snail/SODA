import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { DEFAULT_COLLAPSED, parseLayout, useUiStore } from './ui'

describe('parseLayout', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    for (const raw of [null, '', '{', '[]']) {
      expect(parseLayout(raw)).toEqual({
        collapsed: DEFAULT_COLLAPSED,
        timelinePinned: false,
        clockPinned: false,
        viewTab: 'layers',
        contactJump: 'aos',
      })
    }
  })

  it('keeps well-formed fields and drops the rest', () => {
    const raw = JSON.stringify({
      collapsed: ['a', 3, 'b'],
      timelinePinned: 'yes',
      clockPinned: true,
      viewTab: 'places',
      contactJump: 'tca',
    })
    expect(parseLayout(raw)).toEqual({
      collapsed: ['a', 'b'],
      timelinePinned: false,
      clockPinned: true,
      viewTab: 'places',
      contactJump: 'tca',
    })
    expect(parseLayout(JSON.stringify({ viewTab: 'weather' })).viewTab).toBe('layers')
    expect(parseLayout(JSON.stringify({ contactJump: 'los' })).contactJump).toBe('aos')
  })

  it('starts the docks as icons, even from a layout saved before pinning existed', () => {
    const old = parseLayout(JSON.stringify({ bottomCollapsed: false, clockCollapsed: false }))
    expect(old.timelinePinned).toBe(false)
    expect(old.clockPinned).toBe(false)
  })
})

describe('ui store panels', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('folds the left panel and reopens the tool it last showed', () => {
    const ui = useUiStore()
    ui.openTool('passes')
    ui.toggleLeftPanel()
    expect(ui.activeTool).toBeNull()
    ui.toggleLeftPanel()
    expect(ui.activeTool).toBe('passes')
  })

  it('opens the view tool on a given tab', () => {
    const ui = useUiStore()
    ui.openTool('view', 'markers')
    expect(ui.activeTool).toBe('view')
    expect(ui.viewTab).toBe('markers')
  })

  it('toggles a section fold', () => {
    const ui = useUiStore()
    expect(ui.isCollapsed('x')).toBe(false)
    ui.toggleCollapsed('x')
    expect(ui.isCollapsed('x')).toBe(true)
    ui.toggleCollapsed('x')
    expect(ui.isCollapsed('x')).toBe(false)
  })

  it('opens the satellite tool on a given page', () => {
    const ui = useUiStore()
    ui.openTool('passes')
    ui.openSatelliteStep('runs')
    expect(ui.activeTool).toBe('satellite')
    expect(ui.satelliteStep).toBe('runs')
  })

  it('drops a popped-up dock piece once it is pinned', async () => {
    const ui = useUiStore()
    ui.peek.enter('clock')
    expect(ui.dockPeek).toBe('clock')
    ui.clockPinned = true
    await nextTick()
    expect(ui.dockPeek).toBeNull()
  })
})
