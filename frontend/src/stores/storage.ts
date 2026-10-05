import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { Pass, Station } from '../api/types'
import { elevationSpan, usableWindow } from '../mission/linkWindow'
import { simulateRecorder, type RecorderLink, type RecorderShot } from '../mission/recorder'
import { stationLink, storageModel, type LinkBand } from '../mission/storage'
import { satKey, targetRun } from '../utils/satelliteRef'
import { useMissionStore } from './mission'
import { usePassesStore } from './passes'
import { useRunsStore } from './runs'

/** An imaging window of the result, taken or not. */
export interface StorageWindow {
  /** The shot key, as `mission.excludedShots` holds it. */
  key: string
  targetId: string
  name: string
  bestMs: number
  shotStartMs: number
  shotEndMs: number
}

/** An assigned contact at a downlink station, with the span in which it carries data. */
export interface StorageContact extends RecorderLink {
  station: Station
  band: LinkBand
  aosMs: number
  losMs: number
}

/**
 * The recorder of the target satellite (the selected run when it has elements, else the
 * first that does): its chosen imaging windows write files, its assigned contacts from the
 * pass prediction play them back. Nothing is stored here; it
 * is recomputed as the settings, the imaging result or the pass prediction change.
 */
export const useStorageStore = defineStore('storage', () => {
  const mission = useMissionStore()
  const passes = usePassesStore()
  const runs = useRunsStore()
  const settings = mission.saved.storage

  const run = computed(() => targetRun(runs.selectedRun, runs.runs, true))
  /** The imaging result of the run's satellite, if one was computed. */
  const imaging = computed(() => (run.value ? mission.resultOf(run.value) : null))
  /** The run's satellite in the last pass prediction, or -1 when it was not part of it. */
  const planIndex = computed(() => (run.value ? passes.indexOfSatellite(run.value) : -1))
  const planResults = computed(() =>
    planIndex.value < 0 ? [] : (passes.result?.satellites[planIndex.value]?.results ?? []),
  )
  const planStations = computed(() => planResults.value.map((item) => item.station))
  const model = computed(() => storageModel(settings))

  const windows = computed<StorageWindow[]>(() => {
    const target = run.value
    if (!target) return []
    const key = satKey(target)
    return (
      mission.shots
        .filter((shot) => shot.satKey === key)
        .map((shot) => ({
          key: shot.key,
          targetId: shot.targetId,
          name: shot.targetName,
          bestMs: shot.bestMs,
          // The span the server imaged and the globe draws as a strip, so the two agree.
          shotStartMs: Date.parse(shot.window.shot_start),
          shotEndMs: Date.parse(shot.window.shot_end),
        }))
        // A result of an earlier propagation may reach outside the run as it is now.
        .filter((item) => item.shotEndMs > target.startMs && item.shotStartMs < target.stopMs)
    )
  })

  const shots = computed<RecorderShot[]>(() => {
    const urgent = new Set(settings.urgentTargetIds)
    return windows.value
      .filter((item) => !mission.excludedShots.has(item.key))
      .map((item) => ({
        key: item.key,
        targetId: item.targetId,
        startMs: item.shotStartMs,
        endMs: item.shotEndMs,
        urgent: urgent.has(item.targetId),
      }))
  })

  const contacts = computed<StorageContact[]>(() => {
    const target = run.value
    if (!target) return []
    const { xMinElevDeg, lockS } = model.value
    const contact = (station: Station, pass: Pass): StorageContact | null => {
      const link = stationLink(settings, station.id)
      if (pass.status !== 'assigned' || !link.on) return null
      const aosMs = Date.parse(pass.aos)
      const losMs = Date.parse(pass.los)
      // S-band works down to the station's own horizon; X-band needs more elevation.
      const gate =
        link.band === 's'
          ? { startMs: aosMs, endMs: losMs }
          : elevationSpan(
              {
                aosMs,
                losMs,
                maxElevationDeg: pass.max_elevation_deg,
                track: pass.track_fixed_m,
              },
              station,
              station.min_elev_deg,
              xMinElevDeg,
            )
      const usable = usableWindow(gate, lockS, target.startMs, target.stopMs)
      return {
        passId: pass.id,
        stationId: station.id,
        station,
        band: link.band,
        aosMs,
        losMs,
        startMs: usable?.startMs ?? aosMs,
        endMs: usable?.endMs ?? aosMs,
        rateBps: link.rateBps,
      }
    }
    return planResults.value
      .flatMap((item) => item.passes.map((pass) => contact(item.station, pass)))
      .filter((item): item is StorageContact => item !== null)
      .sort((a, b) => a.aosMs - b.aosMs)
  })

  const result = computed(() => {
    const target = run.value
    if (!target || !imaging.value) return null
    return simulateRecorder({
      startMs: target.startMs,
      endMs: target.stopMs,
      capacityBits: model.value.capacityBits,
      initialBits: model.value.initialBits,
      imageBps: model.value.imageBps,
      shots: shots.value,
      links: contacts.value,
      priority: model.value.priority,
    })
  })

  return { run, imaging, planIndex, planStations, model, windows, shots, contacts, result }
})
