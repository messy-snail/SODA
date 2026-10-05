import type { TmtcContact, TmtcHousekeeping, TmtcLink, TmtcMessage, TmtcPacket } from '../api/types'

/** Packet log entries kept in the browser; older ones fall off. */
export const MAX_LOG = 500

export type LogEntry =
  | (TmtcPacket & { key: number })
  | { type: 'queued'; key: number; command: Record<string, unknown>; queued: number }
  | {
      type: 'reset' | 'dropped' | 'error'
      key: number
      time_ms?: number
      count?: number
      message?: string
    }

export interface TmtcView {
  link: TmtcLink | null
  hk: TmtcHousekeeping | null
  log: LogEntry[]
  /** Set once the server reports a session; cleared when it stops. */
  active: boolean
  /** Every contact of the session, with the track its line of sight follows. */
  contacts: readonly TmtcContact[]
  /** Packets since the spacecraft started, by direction; those the log left out count too. */
  counts: { up: number; down: number }
}

export function emptyView(): TmtcView {
  return { link: null, hk: null, log: [], active: false, contacts: [], counts: { up: 0, down: 0 } }
}

/**
 * The contact to point out on the globe: the one in progress at ``ms``, else the next to
 * come (where "jump to the next AOS" lands). Contacts arrive sorted by AOS.
 */
export function contactInFocus(contacts: readonly TmtcContact[], ms: number): TmtcContact | null {
  return contacts.find((contact) => contact.los_ms > ms) ?? null
}

let counter = 0

/**
 * Fold a batch of server messages into the view. Newest log entries come first so the
 * list reads like a console scrolled to the bottom, upside down.
 */
export function applyMessages(view: TmtcView, messages: readonly TmtcMessage[]): TmtcView {
  let { link, hk, active, contacts } = view
  let { up, down } = view.counts
  const added: LogEntry[] = []
  for (const message of messages) {
    switch (message.type) {
      case 'status':
        active = true
        contacts = message.contacts
        link = message.link
        hk = message.hk
        break
      case 'stopped':
        return emptyView()
      case 'link':
        link = message
        break
      case 'packet':
        added.push({ ...message, key: ++counter })
        if (message.dir === 'up') up += 1
        else down += 1
        if (message.dir === 'down' && message.apid === 100 && !message.replay) {
          hk = message.decoded as unknown as TmtcHousekeeping
        }
        break
      case 'queued':
        added.push({ ...message, key: ++counter })
        if (link) link = { ...link, queued: message.queued }
        break
      case 'reset':
        hk = null
        up = down = 0
        added.push({ type: 'reset', key: ++counter, time_ms: message.time_ms })
        break
      case 'dropped':
        // What gets cut is the head of a burst, which is played-back telemetry.
        down += message.count
        added.push({ type: 'dropped', key: ++counter, count: message.count })
        break
      case 'error':
        added.push({ type: 'error', key: ++counter, message: message.message })
        break
    }
  }
  const log = added.length ? [...added.reverse(), ...view.log].slice(0, MAX_LOG) : view.log
  return { link, hk, log, active, contacts, counts: { up, down } }
}
