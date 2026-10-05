import { describe, expect, it } from 'vitest'
import { hotkeyAction, type HotkeyInput, type HotkeyTarget } from './hotkeys'

const plain: HotkeyTarget = { editable: false, interactive: false, inOverlay: false }

function press(key: string, extra: Partial<HotkeyInput> = {}): HotkeyInput {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    target: plain,
    ...extra,
  }
}

describe('hotkeyAction', () => {
  it('maps the documented keys', () => {
    expect(hotkeyAction(press(' '))).toBe('togglePlay')
    expect(hotkeyAction(press('Escape'))).toBe('deselect')
    expect(hotkeyAction(press('?'))).toBe('toggleHelp')
    expect(hotkeyAction(press('h'))).toBe('home')
    expect(hotkeyAction(press('H'))).toBe('home')
    expect(hotkeyAction(press('m'))).toBe('toggleSceneMode')
    expect(hotkeyAction(press('M'))).toBe('toggleSceneMode')
    expect(hotkeyAction(press('['))).toBe('toggleLeft')
    expect(hotkeyAction(press(']'))).toBeNull()
    expect(hotkeyAction(press('t'))).toBe('toggleBottom')
    expect(hotkeyAction(press('T'))).toBe('toggleBottom')
    expect(hotkeyAction(press('a'))).toBeNull()
  })

  it('leaves text entry and IME composition alone', () => {
    const editable = { ...plain, editable: true }
    for (const key of [' ', 'Escape', '?', 'h', 'm', '[', ']', 't']) {
      expect(hotkeyAction(press(key, { target: editable }))).toBeNull()
      expect(hotkeyAction(press(key, { isComposing: true }))).toBeNull()
    }
  })

  it('ignores modified keys so browser shortcuts keep working', () => {
    expect(hotkeyAction(press(' ', { ctrlKey: true }))).toBeNull()
    expect(hotkeyAction(press('?', { metaKey: true }))).toBeNull()
    expect(hotkeyAction(press('Escape', { altKey: true }))).toBeNull()
  })

  it('lets focused buttons keep Space and open overlays keep Escape', () => {
    expect(hotkeyAction(press(' ', { target: { ...plain, interactive: true } }))).toBeNull()
    expect(hotkeyAction(press('Escape', { target: { ...plain, inOverlay: true } }))).toBeNull()
    expect(hotkeyAction(press('?', { target: { ...plain, interactive: true } }))).toBe('toggleHelp')
  })
})
