import { describe, expect, it } from 'vitest'
import {
  BACKLOG_KEY,
  simulateRecorder,
  type RecorderInput,
  type RecorderLink,
  type RecorderShot,
} from './recorder'

const S = 1000
const shot = (key: string, startS: number, endS: number, urgent = false): RecorderShot => ({
  key,
  targetId: key.split(':')[0]!,
  startMs: startS * S,
  endMs: endS * S,
  urgent,
})
const link = (passId: string, startS: number, endS: number, rateBps: number): RecorderLink => ({
  passId,
  stationId: Number(passId.split(':')[1] ?? 1),
  startMs: startS * S,
  endMs: endS * S,
  rateBps,
})
const run = (input: Partial<RecorderInput>) =>
  simulateRecorder({
    startMs: 0,
    endMs: 100 * S,
    capacityBits: 1000,
    initialBits: 0,
    imageBps: 50,
    shots: [],
    links: [],
    priority: false,
    ...input,
  })
const file = (result: ReturnType<typeof run>, key: string) =>
  result.files.find((item) => item.key === key)!

describe('simulateRecorder', () => {
  it('fills during an acquisition and drains during a contact', () => {
    const result = run({ shots: [shot('a:1', 0, 10)], links: [link('0:1:a', 20, 25, 40)] })
    expect(result.imagedBits).toBe(500)
    expect(result.downlinkedBits).toBe(200)
    expect(result.finalBits).toBe(300)
    expect(result.peakBits).toBe(500)
    expect(result.points).toEqual([
      { ms: 0, value: 0 },
      { ms: 10 * S, value: 500 },
      { ms: 20 * S, value: 500 },
      { ms: 25 * S, value: 300 },
      { ms: 100 * S, value: 300 },
    ])
    expect(file(result, 'a:1')).toMatchObject({ status: 'pending', sentBits: 200 })
    expect(result.pendingCount).toBe(1)
  })

  it('loses an image that does not fit when it starts, and takes the next one that does', () => {
    const result = run({
      capacityBits: 600,
      shots: [shot('a:1', 0, 10), shot('b:1', 20, 30), shot('c:1', 40, 42)],
    })
    expect(file(result, 'b:1')).toMatchObject({ status: 'lost', sentBits: 0 })
    expect(file(result, 'c:1').status).toBe('pending')
    expect(result.lostCount).toBe(1)
    expect(result.lostBits).toBe(500)
    expect(result.lostSpans).toEqual([{ startMs: 20 * S, endMs: 30 * S }])
    expect(result.imagedBits).toBe(600)
    expect(result.peakBits).toBe(600)
  })

  it('reserves the space of an acquisition under way', () => {
    // b starts while a is half written: a's whole 500 is already spoken for.
    const result = run({ capacityBits: 700, shots: [shot('a:1', 0, 10), shot('b:1', 5, 15)] })
    expect(file(result, 'b:1').status).toBe('lost')
    expect(Math.max(...result.points.map((point) => point.value))).toBeLessThanOrEqual(700)
  })

  it('sends nothing of an image before its acquisition ends', () => {
    const result = run({ shots: [shot('a:1', 0, 10)], links: [link('0:1:a', 0, 10, 100)] })
    expect(result.downlinkedBits).toBe(0)
    expect(result.passes[0]).toMatchObject({ sentBits: 0, capacityBits: 1000, usableMs: 10 * S })
  })

  it('resumes a half-sent file on the next contact and reports its latency', () => {
    const result = run({
      shots: [shot('a:1', 0, 10)],
      links: [link('0:1:a', 20, 25, 40), link('0:2:b', 50, 60, 100)],
    })
    // 200 bits in the first pass, the other 300 take 3 s of the second.
    expect(file(result, 'a:1')).toMatchObject({
      status: 'delivered',
      deliveredMs: 53 * S,
      stationId: 2,
      passId: '0:2:b',
      latencyMs: 43 * S,
    })
    expect(result.passes.map((pass) => [pass.sentBits, pass.deliveredFiles])).toEqual([
      [200, 0],
      [300, 1],
    ])
    expect(result.meanLatencyMs).toBe(43 * S)
    expect(result.maxLatencyMs).toBe(43 * S)
    // The link idles once the queue is empty.
    expect(result.points).toContainEqual({ ms: 53 * S, value: 0 })
    expect(result.finalBits).toBe(0)
  })

  it('uses one link at a time, the faster one, when contacts overlap', () => {
    const result = run({
      initialBits: 1000,
      links: [link('0:1:a', 0, 10, 30), link('0:2:b', 5, 10, 50)],
    })
    // 30 b/s for 5 s through the first, then 50 b/s for 5 s through the second.
    expect(result.passes.map((pass) => pass.sentBits)).toEqual([150, 250])
    expect(result.downlinkedBits).toBe(400)
    expect(result.finalBits).toBe(600)
  })

  it('plays back oldest first', () => {
    const result = run({
      shots: [shot('b:1', 20, 22), shot('a:1', 0, 2)],
      links: [link('0:1:a', 30, 40, 20)],
    })
    expect(file(result, 'a:1').deliveredMs).toBe(35 * S)
    expect(file(result, 'b:1').deliveredMs).toBe(40 * S)
    expect(result.files.map((item) => item.key)).toEqual(['a:1', 'b:1'])
  })

  it('lets an urgent image go ahead, and the one it interrupted resumes', () => {
    const shots = [shot('a:1', 0, 4), shot('b:1', 12, 14, true)]
    const links = [link('0:1:a', 10, 30, 10)]
    const fifo = run({ shots, links })
    expect(file(fifo, 'a:1').deliveredMs).toBe(30 * S)
    expect(file(fifo, 'b:1').status).toBe('pending')
    const urgent = run({ shots, links, priority: true })
    // a sends 40 bits until b is ready at 14 s; b's 100 bits take 10 s; a gets the last 6 s.
    expect(file(urgent, 'b:1')).toMatchObject({ status: 'delivered', deliveredMs: 24 * S })
    expect(file(urgent, 'a:1')).toMatchObject({ status: 'pending', sentBits: 100 })
  })

  it('treats the starting fill as the oldest file, outside the image statistics', () => {
    const result = run({
      initialBits: 100,
      shots: [shot('a:1', 0, 2)],
      links: [link('0:1:a', 10, 20, 50)],
    })
    expect(result.files[0]).toMatchObject({
      key: BACKLOG_KEY,
      kind: 'backlog',
      status: 'delivered',
      deliveredMs: 12 * S,
      latencyMs: null,
    })
    expect(file(result, 'a:1').deliveredMs).toBe(14 * S)
    expect(result.deliveredCount).toBe(1)
    expect(result.imagedBits).toBe(100)
    expect(result.downlinkedBits).toBe(200)
    expect(result.meanLatencyMs).toBe(12 * S)
  })

  it('lists a contact with no usable span and sends nothing through it', () => {
    const result = run({ initialBits: 100, links: [link('0:1:a', 30, 30, 50)] })
    expect(result.passes).toEqual([
      expect.objectContaining({ usableMs: 0, capacityBits: 0, sentBits: 0 }),
    ])
    expect(result.finalBits).toBe(100)
  })

  it('reports the starting level when nothing happens', () => {
    const result = run({ capacityBits: 10, initialBits: 20 })
    expect(result.points).toEqual([
      { ms: 0, value: 10 },
      { ms: 100 * S, value: 10 },
    ])
    expect(result.meanLatencyMs).toBeNull()
  })
})
