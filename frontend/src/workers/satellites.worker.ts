/// <reference lib="webworker" />
/**
 * Propagates the whole catalog off the main thread.
 *
 * Adapted from OrbitView ``src/workers/satellite.worker.ts`` (MIT, OrbitView Contributors):
 * Float64 buffers are passed back and forth as transferables instead of being reallocated,
 * and the proximity spatial hash is omitted.
 */
import {
  eciToEcf,
  gstime,
  json2satrec,
  propagate,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js'
import type { Category, Omm } from '../api/types'

export type WorkerRequest =
  { type: 'init'; omms: Omm[] } | { type: 'update'; timeMs: number; buffer: Float64Array }

export type WorkerResponse =
  | { type: 'ready'; ids: Int32Array; categories: Category[]; skipped: number }
  | { type: 'positions'; timeMs: number; buffer: Float64Array }

const DEBRIS_MARKERS = ['DEBRIS', 'ROCKET BODY', ' DEB', 'R/B', 'OBJECT ']

/** Port of the backend ``soda.gp.classify`` rules. */
export function classify(omm: Omm): Category {
  const name = omm.OBJECT_NAME.toUpperCase()
  if (DEBRIS_MARKERS.some((marker) => name.includes(marker))) return 'DEBRIS'
  if (omm.MEAN_MOTION > 11.25) return 'LEO'
  if (omm.MEAN_MOTION > 0.9 && omm.MEAN_MOTION < 1.1 && omm.ECCENTRICITY < 0.1) return 'GEO'
  if (omm.ECCENTRICITY > 0.25) return 'HEO'
  return 'MEO'
}

let satrecs: SatRec[] = []

function init(omms: Omm[]) {
  satrecs = []
  const ids: number[] = []
  const categories: Category[] = []
  let skipped = 0
  for (const omm of omms) {
    try {
      satrecs.push(json2satrec(omm as unknown as OMMJsonObject))
      ids.push(omm.NORAD_CAT_ID)
      categories.push(classify(omm))
    } catch {
      skipped++
    }
  }
  const response: WorkerResponse = { type: 'ready', ids: Int32Array.from(ids), categories, skipped }
  postMessage(response)
}

function update(timeMs: number, buffer: Float64Array) {
  const size = satrecs.length * 3
  const out = buffer.length === size ? buffer : new Float64Array(size)
  const date = new Date(timeMs)
  const gmst = gstime(date)
  for (let i = 0; i < satrecs.length; i++) {
    const state = propagate(satrecs[i]!, date)
    const position = state?.position
    if (!position || typeof position === 'boolean') {
      out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = Number.NaN
      continue
    }
    const ecf = eciToEcf(position, gmst)
    out[3 * i] = ecf.x * 1000
    out[3 * i + 1] = ecf.y * 1000
    out[3 * i + 2] = ecf.z * 1000
  }
  const response: WorkerResponse = { type: 'positions', timeMs, buffer: out }
  postMessage(response, [out.buffer])
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'init') init(message.omms)
  else update(message.timeMs, message.buffer)
}
