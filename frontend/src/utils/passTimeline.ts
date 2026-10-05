/** Layout maths for the per-station pass timeline. Pure, so it can be tested directly. */

import type { ContactJump } from '../stores/ui'
import { formatUtc } from './time'

const HOUR_MS = 3_600_000
/** A 24 s pass is 0.03 % of a one-day window, so bars get a floor to stay clickable. */
export const MIN_BAR_WIDTH = 0.004
const TICK_STEPS_MS = [HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS, 24 * HOUR_MS]
/** Steps for a window shorter than an hour, such as a single pass. */
const FINE_TICK_STEPS_MS = [1, 2, 5, 10, 15, 30].map((minutes) => minutes * 60_000)

export interface Bar {
  /** Left edge as a fraction of the window. */
  start: number
  /** Width as a fraction of the window, floored at MIN_BAR_WIDTH. */
  width: number
  /** The pass runs past an edge of the window and is drawn cut off there. */
  clipped: boolean
}

/** Place one interval inside the window, or null when it falls entirely outside. */
export function barLayout(
  startMs: number,
  endMs: number,
  windowStartMs: number,
  windowEndMs: number,
): Bar | null {
  const span = windowEndMs - windowStartMs
  if (span <= 0 || endMs <= windowStartMs || startMs >= windowEndMs) return null
  const from = Math.max(startMs, windowStartMs)
  const to = Math.min(endMs, windowEndMs)
  const start = (from - windowStartMs) / span
  const width = Math.max((to - from) / span, MIN_BAR_WIDTH)
  return {
    // Keep a floored bar inside the track instead of letting it hang off the right edge.
    start: Math.min(start, 1 - width),
    width,
    clipped: startMs < windowStartMs || endMs > windowEndMs,
  }
}

export interface Tick {
  /** Position as a fraction of the window. */
  at: number
  ms: number
}

/** Round UTC times across the window, at most ``maxTicks`` of them. */
export function timelineTicks(windowStartMs: number, windowEndMs: number, maxTicks = 6): Tick[] {
  const span = windowEndMs - windowStartMs
  if (span <= 0 || maxTicks < 1) return []
  const steps = span < HOUR_MS ? [...FINE_TICK_STEPS_MS, ...TICK_STEPS_MS] : TICK_STEPS_MS
  const step =
    steps.find((candidate) => span / candidate <= maxTicks) ??
    Math.ceil(span / maxTicks / (24 * HOUR_MS)) * 24 * HOUR_MS
  const ticks: Tick[] = []
  for (let ms = Math.ceil(windowStartMs / step) * step; ms <= windowEndMs; ms += step) {
    ticks.push({ at: (ms - windowStartMs) / span, ms })
  }
  return ticks
}

/** Clock time a click on a contact or pass jumps to: its AOS or its culmination. */
export function jumpTarget(contact: { aos: string; tca: string }, mode: ContactJump): number {
  return Date.parse(mode === 'tca' ? contact.tca : contact.aos)
}

export interface PassSpan {
  /** UTC ``MM-DD`` of AOS. */
  date: string
  /** UTC ``HH:MM:SS`` of AOS. */
  aos: string
  /** UTC ``HH:MM:SS`` of LOS, prefixed with ``MM-DD`` when it falls on another day. */
  los: string
}

/** AOS and LOS as compact UTC text for a pass row. */
export function passSpan(aosMs: number, losMs: number): PassSpan {
  const aos = formatUtc(aosMs)
  const los = formatUtc(losMs)
  const sameDay = aos.slice(0, 10) === los.slice(0, 10)
  return {
    date: aos.slice(5, 10),
    aos: aos.slice(11),
    los: sameDay ? los.slice(11) : `${los.slice(5, 10)} ${los.slice(11)}`,
  }
}

export interface ActiveContact<T> {
  entry: T
  /** Time left until LOS, in ms. */
  remainingMs: number
}

/** Contacts whose AOS–LOS interval (inclusive) holds ``ms``, earliest AOS first. */
export function activeContacts<T extends { pass: { aos: string; los: string } }>(
  entries: readonly T[],
  ms: number,
): ActiveContact<T>[] {
  return entries
    .filter((entry) => Date.parse(entry.pass.aos) <= ms && ms <= Date.parse(entry.pass.los))
    .map((entry) => ({ entry, remainingMs: Date.parse(entry.pass.los) - ms }))
}

/** ``MM:SS`` countdown, or ``H:MM:SS`` from an hour up. Negative input reads as zero. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return hours ? `${hours}:${rest}` : rest
}
