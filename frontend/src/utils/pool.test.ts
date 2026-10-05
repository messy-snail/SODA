import { describe, expect, it } from 'vitest'
import { runPool } from './pool'

describe('runPool', () => {
  it('runs every item with at most the limit in flight', async () => {
    let flying = 0
    let peak = 0
    const seen: number[] = []
    await runPool([1, 2, 3, 4, 5], 2, new AbortController().signal, async (item) => {
      flying += 1
      peak = Math.max(peak, flying)
      await Promise.resolve()
      seen.push(item)
      flying -= 1
    })
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
    expect(peak).toBe(2)
  })

  it('hands out nothing more once aborted', async () => {
    const controller = new AbortController()
    const seen: number[] = []
    await runPool([1, 2, 3, 4], 1, controller.signal, async (item) => {
      seen.push(item)
      if (item === 2) controller.abort()
    })
    expect(seen).toEqual([1, 2])
  })

  it('passes each item its index', async () => {
    const pairs: [string, number][] = []
    await runPool(['a', 'b'], 3, new AbortController().signal, async (item, index) => {
      pairs.push([item, index])
    })
    expect(pairs).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })
})
