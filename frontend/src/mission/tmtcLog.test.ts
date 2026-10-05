import { describe, expect, it } from 'vitest'
import type { TmtcMessage, TmtcPacket } from '../api/types'
import { applyMessages, contactInFocus, emptyView, MAX_LOG } from './tmtcLog'

const hk = {
  time_ms: 10,
  mode: 'NOMINAL' as const,
  command_count: 0,
  rejected_count: 0,
  battery_pct: 80,
  storage_pct: 10,
}

const packet = (overrides: Partial<TmtcPacket> = {}): TmtcPacket => ({
  type: 'packet',
  dir: 'down',
  apid: 100,
  seq: 0,
  time_ms: 10,
  replay: false,
  hex: '00',
  decoded: hk,
  ...overrides,
})

describe('applyMessages', () => {
  it('tracks the live housekeeping but not played-back copies', () => {
    const live = applyMessages(emptyView(), [packet()])
    expect(live.hk).toEqual(hk)
    const replay = applyMessages(emptyView(), [packet({ replay: true })])
    expect(replay.hk).toBeNull()
    expect(replay.log).toHaveLength(1)
  })

  it('puts the newest entries first and caps the log', () => {
    const many = Array.from({ length: MAX_LOG + 20 }, (_, seq) => packet({ seq }))
    const view = applyMessages(emptyView(), many)
    expect(view.log).toHaveLength(MAX_LOG)
    expect((view.log[0] as TmtcPacket).seq).toBe(MAX_LOG + 19)
  })

  it('starts, follows the link, and stops', () => {
    const status: TmtcMessage = { type: 'status', name: 'SAT', contacts: [], link: null, hk: null }
    const link: TmtcMessage = {
      type: 'link',
      open: true,
      time_ms: 5,
      station_id: 1,
      delay_ms: 3,
      next_aos_ms: null,
      queued: 0,
      onboard: 0,
    }
    let view = applyMessages(emptyView(), [status, link])
    expect(view.active).toBe(true)
    expect(view.link?.open).toBe(true)
    view = applyMessages(view, [{ type: 'queued', command: { command: 'NOOP' }, queued: 2 }])
    expect(view.link?.queued).toBe(2)
    expect(applyMessages(view, [{ type: 'stopped' }])).toEqual(emptyView())
  })

  it('keeps the contacts a session starts with', () => {
    const contacts = [{ aos_ms: 10, los_ms: 20, station_id: 7, track_fixed_m: [1, 2, 3, 4, 5, 6] }]
    const view = applyMessages(emptyView(), [
      { type: 'status', name: 'SAT', contacts, link: null, hk: null },
      packet(),
    ])
    expect(view.contacts).toBe(contacts)
  })

  it('counts packets by direction, the unlisted ones too, until the spacecraft restarts', () => {
    let view = applyMessages(emptyView(), [
      { type: 'dropped', count: 5 },
      packet(),
      packet({ dir: 'up', apid: 200 }),
    ])
    expect(view.counts).toEqual({ up: 1, down: 6 })
    view = applyMessages(view, [packet()])
    expect(view.counts).toEqual({ up: 1, down: 7 })
    view = applyMessages(view, [{ type: 'reset', time_ms: 0 }])
    expect(view.counts).toEqual({ up: 0, down: 0 })
  })
})

describe('contactInFocus', () => {
  const contact = (aos_ms: number, los_ms: number) => ({
    aos_ms,
    los_ms,
    station_id: 1,
    track_fixed_m: [],
  })
  const contacts = [contact(10, 20), contact(50, 60)]

  it('is the contact in progress, else the next one', () => {
    expect(contactInFocus(contacts, 0)).toBe(contacts[0])
    expect(contactInFocus(contacts, 15)).toBe(contacts[0])
    expect(contactInFocus(contacts, 20)).toBe(contacts[1])
    expect(contactInFocus(contacts, 55)).toBe(contacts[1])
  })

  it('is nothing once the last contact is over', () => {
    expect(contactInFocus(contacts, 60)).toBeNull()
    expect(contactInFocus([], 0)).toBeNull()
  })
})
