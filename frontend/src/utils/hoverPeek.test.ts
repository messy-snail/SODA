import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHoverPeek, PEEK_CLOSE_DELAY_MS } from './hoverPeek'

describe('createHoverPeek', () => {
  let shown: string | null
  const peek = () => createHoverPeek<string>((key) => (shown = key))

  beforeEach(() => {
    shown = null
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('shows on enter and hides a moment after leave', () => {
    const hover = peek()
    hover.enter('clock')
    expect(shown).toBe('clock')
    hover.leave()
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS - 1)
    expect(shown).toBe('clock')
    vi.advanceTimersByTime(1)
    expect(shown).toBeNull()
  })

  it('stays open when the pointer moves from the icon onto the piece', () => {
    const hover = peek()
    hover.enter('timeline')
    hover.leave()
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS / 2)
    hover.enter('timeline')
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2)
    expect(shown).toBe('timeline')
  })

  it('switches pieces and closes at once on close', () => {
    const hover = peek()
    hover.enter('timeline')
    hover.enter('clock')
    expect(shown).toBe('clock')
    hover.leave()
    hover.close()
    expect(shown).toBeNull()
    hover.enter('clock')
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2)
    expect(shown).toBe('clock')
  })

  it('stays up while held and closes after release and leave', () => {
    const hover = peek()
    hover.enter('clock')
    hover.leave()
    hover.hold()
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2)
    expect(shown).toBe('clock')
    hover.leave()
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 2)
    expect(shown).toBe('clock')
    hover.release()
    hover.leave()
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS)
    expect(shown).toBeNull()
  })

  it('closes at once on close even while held', () => {
    const hover = peek()
    hover.enter('clock')
    hover.hold()
    hover.close()
    expect(shown).toBeNull()
    hover.enter('clock')
    hover.leave()
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS)
    expect(shown).toBeNull()
  })
})
