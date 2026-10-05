import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick } from 'vue'
import { api } from '../api/client'
import type { PropagateResponse, SwathResponse } from '../api/types'
import { useClockStore } from './clock'
import { useRunsStore } from './runs'
import { useSelectionStore } from './selection'

function response(days = 1): PropagateResponse {
  return {
    element_set: { name: 'Test satellite' },
    start: '2026-09-24T00:00:00Z',
    step_s: 30,
    count: days * 2880 + 1,
    invalid: [],
    fixed_m: [],
    inertial_m: [],
    warnings: [],
  } as unknown as PropagateResponse
}
const input = {
  noradId: 25544,
  customId: null,
  startMs: Date.UTC(2026, 8, 24),
  endMs: Date.UTC(2026, 8, 25),
  stepS: 30,
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('propagation replacement', () => {
  it('replaces in place, retaining colour, selection and tracking with a fresh identity', async () => {
    vi.spyOn(api, 'propagate')
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(7))
    const store = useRunsStore()
    const first = (await store.propagate(input))!
    const other = (await store.propagate({ ...input, noradId: 12345 }))!
    store.track(first.id)
    store.hoveredRunId = first.id
    const replacement = (await store.propagate({ ...input, endMs: input.startMs + 7 * 86400000 }))!
    expect(store.runs).toEqual([replacement, other])
    expect(replacement.id).not.toBe(first.id)
    expect(replacement.colorIndex).toBe(first.colorIndex)
    expect(store.selectedRunId).toBe(replacement.id)
    expect(store.trackedRunId).toBe(replacement.id)
    expect(store.hoveredRunId).toBeNull()
    expect(useClockStore().stopMs).toBe(input.startMs + 7 * 86400000)
  })

  it('keeps pasted elements apart from the catalog run with the same NORAD number', async () => {
    const pasted = response()
    pasted.element_set = { ...pasted.element_set, norad_id: 25544, custom_id: 4 }
    const call = vi
      .spyOn(api, 'propagate')
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(pasted)
    const store = useRunsStore()
    const catalogRun = (await store.propagate(input))!
    const pastedRun = (await store.propagate({ ...input, noradId: 0, customId: 4 }))!
    expect(store.runs).toEqual([catalogRun, pastedRun])
    expect(pastedRun.noradId).toBe(25544)
    expect(call.mock.calls[1]![0]).toMatchObject({ custom_id: 4 })
    expect(call.mock.calls[1]![0]).not.toHaveProperty('norad_id')
  })

  it('propagates a batch in turn, noting failures and spanning every new run', async () => {
    vi.spyOn(api, 'propagate')
      .mockResolvedValueOnce(response(1))
      .mockRejectedValueOnce(new Error('no elements'))
      .mockResolvedValueOnce(response(3))
    const store = useRunsStore()
    const made = await store.propagateMany([
      { ...input, name: 'ONE' },
      { ...input, noradId: 2, name: 'TWO' },
      { ...input, noradId: 3, name: 'THREE' },
    ])
    expect(made).toHaveLength(2)
    expect(store.failures).toEqual([{ name: 'TWO', message: 'Error: no elements' }])
    expect(store.selectedRunId).toBe(made[0]!.id)
    expect(store.progress).toBeNull()
    expect(useClockStore().stopMs).toBe(made[1]!.stopMs)
  })

  it('retains hidden results during requests and failure, and prevents concurrent requests', async () => {
    const call = vi.spyOn(api, 'propagate').mockResolvedValue(response())
    const store = useRunsStore()
    const first = (await store.propagate(input))!
    store.toggleVisible(first.id)
    let reject!: (error: Error) => void
    call.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const pending = store.propagate(input)
    expect(await store.propagate(input)).toBeNull()
    expect(call).toHaveBeenCalledTimes(2)
    expect(store.runs[0]?.id).toBe(first.id)
    reject(new Error('Unavailable'))
    expect(await pending).toBeNull()
    expect(store.runs[0]?.visible).toBe(false)
    const replacement = (await store.propagate(input))!
    expect(replacement.visible).toBe(false)
    expect(store.runs).toHaveLength(1)
  })

  it('refreshes selected swath and ignores an obsolete response even if abort is ignored', async () => {
    vi.spyOn(api, 'propagate').mockResolvedValueOnce(response()).mockResolvedValueOnce(response(7))
    let finishOld!: (data: SwathResponse) => void
    const fresh = { segments: [] } as unknown as SwathResponse
    vi.spyOn(api, 'swath')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          }),
      )
      .mockResolvedValueOnce(fresh)
    const scope = effectScope()
    const selection = scope.run(() => useSelectionStore())!
    selection.drawEnabled = true
    await nextTick()
    const store = useRunsStore()
    const first = (await store.propagate(input))!
    store.select(first.id)
    await nextTick()
    const replacement = (await store.propagate(input))!
    await nextTick()
    await Promise.resolve()
    finishOld({ segments: [{ kind: 'nadir' }] } as unknown as SwathResponse)
    await Promise.resolve()
    expect(selection.swathRunId).toBe(replacement.id)
    expect(selection.swath).toEqual(fresh)
    scope.stop()
  })
  it('computes the swath only while drawing is switched on', async () => {
    vi.spyOn(api, 'propagate').mockResolvedValue(response())
    const drawn = { segments: [] } as unknown as SwathResponse
    const call = vi.spyOn(api, 'swath').mockResolvedValue(drawn)
    const scope = effectScope()
    const selection = scope.run(() => useSelectionStore())!
    const store = useRunsStore()
    const run = (await store.propagate(input))!
    store.select(run.id)
    await nextTick()
    expect(call).not.toHaveBeenCalled()
    expect(selection.swath).toBeNull()

    selection.drawEnabled = true
    await nextTick()
    await Promise.resolve()
    expect(call).toHaveBeenCalledTimes(1)
    expect(selection.swathRunId).toBe(run.id)

    selection.drawEnabled = false
    await nextTick()
    expect(selection.swath).toBeNull()
    expect(selection.swathRunId).toBeNull()
    scope.stop()
  })
})
