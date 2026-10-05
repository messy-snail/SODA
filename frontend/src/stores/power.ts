import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { api } from '../api/client'
import type { PowerRequest, PowerResponse } from '../api/types'
import { powerModel, powerSettingsValid } from '../mission/power'
import { isDownlinkStation } from '../mission/storage'
import { hasElements, refParams, satKey, targetRun } from '../utils/satelliteRef'
import { useMissionStore } from './mission'
import { usePassesStore } from './passes'
import { useRunsStore } from './runs'

/** Shortest stretch of a run left to simulate after the chosen start. */
const MIN_SPAN_MS = 1000

/**
 * Battery state of charge for the target run (the selected one, else the first), with the
 * acquisitions of the imaging result and the contacts of the pass prediction when they are
 * for that satellite. Without either it is the eclipse cycle and the base load.
 */
export const usePowerStore = defineStore('power', () => {
  const runs = useRunsStore()
  const mission = useMissionStore()
  const passes = usePassesStore()
  const result = shallowRef<PowerResponse | null>(null)
  /** Run the result was computed for. */
  const resultRunId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<unknown>(null)
  let controller: AbortController | null = null

  const run = computed(() => targetRun(runs.selectedRun, runs.runs, false))
  /** Time the user gave for the starting state of charge; it is only used inside the run. */
  const chosenSocAtMs = ref<number | null>(null)

  /** When the starting state of charge applies: the chosen time, else the start of the run. */
  const socAtMs = computed(() => {
    const target = run.value
    if (!target) return null
    const chosen = chosenSocAtMs.value
    return chosen !== null && chosen > target.startMs && chosen < target.stopMs
      ? chosen
      : target.startMs
  })

  /** The imaging result of the run's satellite, if one was computed. */
  const imaging = computed(() => (run.value ? mission.resultOf(run.value) : null))

  const shots = computed<PowerRequest['shots']>(() => {
    const key = run.value ? satKey(run.value) : ''
    return mission.shots
      .filter((shot) => shot.satKey === key && !mission.excludedShots.has(shot.key))
      .map(({ window }) => ({
        start: window.shot_start,
        end: window.shot_end,
        roll_deg: window.roll_deg,
        pitch_deg: window.pitch_deg,
      }))
  })

  /** The run's satellite in the last pass prediction, or -1 when it was not part of it. */
  const planIndex = computed(() => (run.value ? passes.indexOfSatellite(run.value) : -1))

  /**
   * What is missing or out of date among the inputs, when that would otherwise go unseen:
   * another satellite has a pass plan or an imaging result and this one does not, or the
   * ones it has were computed for an earlier propagation of it.
   */
  const notices = computed(() => {
    const target = run.value
    if (!target || !hasElements(target)) return { noPlan: false, noShots: false, stale: false }
    const planned = planIndex.value >= 0
    return {
      noPlan: !!passes.result && !planned,
      noShots: mission.results.length > 0 && !imaging.value,
      stale:
        (planned && passes.resultRunIds[planIndex.value] !== target.id) ||
        (!!imaging.value && imaging.value.run.id !== target.id),
    }
  })

  const contacts = computed<PowerRequest['contacts']>(() => {
    const satellite = planIndex.value < 0 ? null : passes.result?.satellites[planIndex.value]
    return (satellite?.results ?? [])
      .flatMap((item) => item.passes)
      .filter((contact) => contact.status === 'assigned')
      .map((contact) => ({
        start: contact.aos,
        end: contact.los,
        station_id: contact.station_id,
        downlink: isDownlinkStation(mission.saved.storage, contact.station_id),
      }))
  })

  /** The request for the inputs as they are now, or null while it cannot be sent. */
  const request = computed<PowerRequest | null>(() => {
    const target = run.value
    if (!target || !powerSettingsValid(mission.saved.power)) return null
    return {
      ...refParams(target),
      start: new Date(target.startMs).toISOString(),
      end: new Date(target.stopMs).toISOString(),
      step_s: target.data.step_s,
      propagator: target.propagator,
      ...(target.hpop ? { hpop: target.hpop } : {}),
      shots: shots.value,
      contacts: contacts.value,
      ...(socAtMs.value !== null && socAtMs.value !== target.startMs
        ? { soc_at: new Date(socAtMs.value).toISOString() }
        : {}),
      power: powerModel(mission.saved.power),
    }
  })

  /** The result, as long as it is for the run the tool is showing. */
  const current = computed(() =>
    result.value && resultRunId.value === run.value?.id ? result.value : null,
  )

  async function compute() {
    const body = request.value
    const target = run.value
    if (!body || !target) return
    controller?.abort()
    const own = new AbortController()
    controller = own
    loading.value = true
    error.value = null
    try {
      const response = await api.power(body, own.signal)
      if (own.signal.aborted) return
      result.value = markRaw(response)
      resultRunId.value = target.id
    } catch (caught) {
      if (!own.signal.aborted) error.value = caught
    } finally {
      if (controller === own) {
        loading.value = false
        controller = null
      }
    }
  }

  /** Start the battery from `ms`, kept inside the run; null goes back to the run's start. */
  function setSocAt(ms: number | null) {
    const target = run.value
    chosenSocAtMs.value =
      ms === null || !target
        ? null
        : Math.min(Math.max(ms, target.startMs), target.stopMs - MIN_SPAN_MS)
  }

  return {
    run,
    shots,
    contacts,
    planIndex,
    notices,
    socAtMs,
    request,
    result: current,
    loading,
    error,
    compute,
    setSocAt,
  }
})
