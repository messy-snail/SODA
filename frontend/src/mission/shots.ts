import type { AccessResponse, AccessWindow } from '../api/types'
import type { SatelliteRef } from '../utils/satelliteRef'
import type { ImagingTarget } from './targets'

/**
 * The propagated run an imaging search covers. Searching only inside it keeps every
 * result on the orbit the globe can draw, so jumping to one never leaves the run.
 */
export interface AccessRun extends SatelliteRef {
  id: string
  name: string
  startMs: number
  stopMs: number
  /** Orbit palette index, so results are drawn in the satellite's colour. */
  colorIndex: number
}

/** The imaging result of one satellite. */
export interface SatelliteAccess {
  /** `satKey` of the satellite. */
  key: string
  run: AccessRun
  response: AccessResponse
}

/** One imaging window of one target by one satellite. */
export interface Shot {
  /** Unique among every satellite's windows; also the globe entity id after `access:`. */
  key: string
  satKey: string
  run: AccessRun
  targetId: string
  targetName: string
  box: boolean
  window: AccessWindow
  bestMs: number
}

/** A satellite key without the colon, for ids that are split on colons. */
export function satSlug(satKey: string): string {
  return satKey.replace(':', '-')
}

export function shotKey(satKey: string, targetId: string, start: string): string {
  return `${satSlug(satKey)}:${targetId}:${start}`
}

/**
 * Every window of every satellite and target, in time order. Windows of deleted targets
 * and of satellites that no longer have a run drop out.
 */
export function flattenShots(
  results: readonly SatelliteAccess[],
  targets: readonly ImagingTarget[],
  liveSatKeys: ReadonlySet<string>,
): Shot[] {
  const byId = new Map(targets.map((target) => [target.id, target]))
  const shots: Shot[] = []
  for (const { key, run, response } of results) {
    if (!liveSatKeys.has(key)) continue
    for (const { target_id: targetId, windows } of response.results) {
      const target = byId.get(targetId)
      if (!target) continue
      for (const window of windows) {
        shots.push({
          key: shotKey(key, targetId, window.start),
          satKey: key,
          run,
          targetId,
          targetName: target.name,
          box: target.kind === 'box',
          window,
          bestMs: Date.parse(window.best_time),
        })
      }
    }
  }
  return shots.sort((a, b) => a.bestMs - b.bestMs)
}
