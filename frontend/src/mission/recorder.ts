/**
 * The onboard recorder as a set of image files: every acquisition writes one, and ground
 * contacts play them back in order.
 *
 * - An image is taken only if it fits when the acquisition starts; otherwise it is lost.
 * - A file can be sent once its acquisition has ended, through one link at a time.
 * - Sent data is deleted at once, and a file half sent resumes on the next contact.
 *
 * Rates are constant inside every span, so the fill level is piecewise linear. Pure, so it
 * is unit tested.
 */
import type { LevelPoint, TimeSpan } from '../utils/levelChart'

export interface RecorderShot {
  /** The shot key, as `mission.excludedShots` holds it. */
  key: string
  targetId: string
  startMs: number
  endMs: number
  /** Sent ahead of the others when playback goes by priority. */
  urgent: boolean
}

/** A contact and the span in which it can carry data; `endMs <= startMs` means none. */
export interface RecorderLink {
  passId: string
  stationId: number
  startMs: number
  endMs: number
  rateBps: number
}

export interface RecorderInput {
  /** The simulated span; the level is reported from one end to the other. */
  startMs: number
  endMs: number
  capacityBits: number
  /** Already stored at `startMs`, older than every image. */
  initialBits: number
  /** Bits stored per second of acquisition, after compression. */
  imageBps: number
  shots: readonly RecorderShot[]
  links: readonly RecorderLink[]
  /** Urgent files first; otherwise strictly oldest first. */
  priority: boolean
}

export type FileStatus = 'delivered' | 'pending' | 'lost'

export interface RecorderFile {
  key: string
  /** `backlog` is what the recorder already held at the start. */
  kind: 'image' | 'backlog'
  targetId: string | null
  startMs: number
  endMs: number
  sizeBits: number
  sentBits: number
  urgent: boolean
  status: FileStatus
  /** When the last bit went down. */
  deliveredMs: number | null
  /** Station and pass that sent the last bit. */
  stationId: number | null
  passId: string | null
  /** From the end of the acquisition to `deliveredMs`. */
  latencyMs: number | null
}

export interface RecorderPass {
  passId: string
  stationId: number
  startMs: number
  endMs: number
  usableMs: number
  /** What the usable span could carry at the link's rate. */
  capacityBits: number
  sentBits: number
  /** Files whose last bit went down in this pass. */
  deliveredFiles: number
}

export interface RecorderResult {
  /** Fill level at every change of slope, from `startMs` to `endMs`. */
  points: LevelPoint[]
  /** The backlog first, then the images in the order they were taken. */
  files: RecorderFile[]
  passes: RecorderPass[]
  /** Acquisitions that did not fit. */
  lostSpans: TimeSpan[]
  /** Stored images only; lost ones are in `lostBits`. */
  imagedBits: number
  downlinkedBits: number
  peakBits: number
  finalBits: number
  lostCount: number
  lostBits: number
  deliveredCount: number
  pendingCount: number
  /** Over delivered images; null when none was. */
  meanLatencyMs: number | null
  maxLatencyMs: number | null
}

export const BACKLOG_KEY = 'backlog'

/** Slack for sums of floating-point bit counts. */
const EPSILON_BITS = 1e-6

export function simulateRecorder(input: RecorderInput): RecorderResult {
  const { capacityBits, startMs, endMs } = input
  const slots: RecorderFile[] = []
  /** Files that got their space; an image joins when its acquisition starts and it fits. */
  const admitted = new Set<RecorderFile>()
  const blank = { sentBits: 0, deliveredMs: null, stationId: null, passId: null, latencyMs: null }
  const initialBits = Math.min(Math.max(input.initialBits, 0), capacityBits)
  if (initialBits > 0) {
    slots.push({
      ...blank,
      key: BACKLOG_KEY,
      kind: 'backlog',
      targetId: null,
      startMs,
      endMs: startMs,
      sizeBits: initialBits,
      urgent: false,
      status: 'pending',
    })
    admitted.add(slots[0]!)
  }
  const shots = input.shots
    .filter((shot) => shot.endMs > shot.startMs && shot.startMs < endMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  for (const shot of shots) {
    slots.push({
      ...blank,
      key: shot.key,
      kind: 'image',
      targetId: shot.targetId,
      startMs: shot.startMs,
      endMs: shot.endMs,
      sizeBits: (input.imageBps * (shot.endMs - shot.startMs)) / 1000,
      urgent: shot.urgent,
      status: 'pending',
    })
  }

  const passes: RecorderPass[] = input.links.map((link) => {
    const usableMs = Math.max(link.endMs - link.startMs, 0)
    return {
      passId: link.passId,
      stationId: link.stationId,
      startMs: link.startMs,
      endMs: Math.max(link.endMs, link.startMs),
      usableMs,
      capacityBits: (Math.max(link.rateBps, 0) * usableMs) / 1000,
      sentBits: 0,
      deliveredFiles: 0,
    }
  })
  const links = input.links
    .map((link, index) => ({ ...link, pass: passes[index]! }))
    .filter((link) => link.endMs > link.startMs && link.rateBps > 0)

  /** What a file has written by `ms`: it grows evenly over its acquisition. */
  const written = (slot: RecorderFile, ms: number) =>
    !admitted.has(slot)
      ? 0
      : ms >= slot.endMs
        ? slot.sizeBits
        : ms <= slot.startMs
          ? 0
          : (slot.sizeBits * (ms - slot.startMs)) / (slot.endMs - slot.startMs)
  // Summed from the files each time rather than accumulated, so rounding cannot drift.
  const levelAt = (ms: number) =>
    slots.reduce((sum, slot) => sum + Math.max(written(slot, ms) - slot.sentBits, 0), 0)
  /** Space spoken for: everything admitted and not yet sent, acquisitions under way included. */
  const reserved = () =>
    slots.reduce((sum, slot) => (admitted.has(slot) ? sum + slot.sizeBits - slot.sentBits : sum), 0)

  const points: LevelPoint[] = []
  let peakBits = 0
  const push = (ms: number) => {
    const value = levelAt(ms)
    const last = points[points.length - 1]
    if (last && last.ms === ms) last.value = value
    else points.push({ ms, value })
    peakBits = Math.max(peakBits, value)
  }
  const lostSpans: TimeSpan[] = []

  const order = (a: RecorderFile, b: RecorderFile) =>
    (input.priority ? Number(b.urgent) - Number(a.urgent) : 0) ||
    a.endMs - b.endMs ||
    a.startMs - b.startMs ||
    (a.key < b.key ? -1 : 1)

  const edges = [
    ...new Set([
      startMs,
      endMs,
      ...slots.flatMap((slot) => [slot.startMs, slot.endMs]),
      ...links.flatMap((link) => [link.startMs, link.endMs]),
    ]),
  ]
    .filter((ms) => ms >= startMs && ms <= endMs)
    .sort((a, b) => a - b)

  push(startMs)
  for (let k = 0; k + 1 < edges.length; k++) {
    const from = edges[k]!
    const to = edges[k + 1]!
    for (const slot of slots) {
      if (admitted.has(slot) || slot.status === 'lost' || slot.startMs > from) continue
      if (slot.sizeBits <= capacityBits - reserved() + EPSILON_BITS) admitted.add(slot)
      else {
        slot.status = 'lost'
        lostSpans.push({ startMs: slot.startMs, endMs: slot.endMs })
      }
    }
    const link = links
      .filter((item) => item.startMs <= from && from < item.endMs)
      .sort(
        (a, b) => b.rateBps - a.rateBps || a.startMs - b.startMs || a.stationId - b.stationId,
      )[0]
    if (link) {
      // Only what was finished by `from` can go; nothing else finishes before `to`.
      const queue = slots
        .filter((slot) => admitted.has(slot) && slot.status === 'pending' && slot.endMs <= from)
        .sort(order)
      let ms = from
      for (const slot of queue) {
        const need = slot.sizeBits - slot.sentBits
        const can = (link.rateBps * (to - ms)) / 1000
        if (need > can + EPSILON_BITS) {
          slot.sentBits += can
          link.pass.sentBits += can
          ms = to
          break
        }
        ms = Math.min(ms + (need / link.rateBps) * 1000, to)
        slot.sentBits = slot.sizeBits
        slot.status = 'delivered'
        slot.deliveredMs = ms
        slot.stationId = link.stationId
        slot.passId = link.passId
        if (slot.kind === 'image') slot.latencyMs = ms - slot.endMs
        link.pass.sentBits += need
        link.pass.deliveredFiles += 1
      }
      // The queue ran dry before the span did: the link idles from here.
      if (ms > from && ms < to) push(ms)
    }
    push(to)
  }

  const images = slots.filter((slot) => slot.kind === 'image')
  const delivered = images.filter((slot) => slot.status === 'delivered')
  const lost = images.filter((slot) => slot.status === 'lost')
  const latencies = delivered.map((slot) => slot.latencyMs ?? 0)
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  return {
    points,
    files: slots,
    passes,
    lostSpans,
    imagedBits: sum(images.filter((slot) => admitted.has(slot)).map((slot) => slot.sizeBits)),
    downlinkedBits: sum(slots.map((slot) => slot.sentBits)),
    peakBits,
    finalBits: levelAt(endMs),
    lostCount: lost.length,
    lostBits: sum(lost.map((slot) => slot.sizeBits)),
    deliveredCount: delivered.length,
    pendingCount: images.length - delivered.length - lost.length,
    meanLatencyMs: latencies.length ? sum(latencies) / latencies.length : null,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
  }
}
