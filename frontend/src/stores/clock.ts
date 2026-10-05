import { ClockRange, ClockStep, JulianDate, type Clock } from 'cesium'
import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'

const HALF_DAY_MS = 12 * 3_600_000

/** Mirrors the Cesium clock, which stays the single source of truth for simulation time. */
export const useClockStore = defineStore('clock', () => {
  let clock: Clock | null = null
  const currentMs = ref(Date.now())
  const startMs = ref(Date.now() - HALF_DAY_MS)
  const stopMs = ref(Date.now() + HALF_DAY_MS)
  const playing = ref(true)
  const multiplier = ref(1)
  const bounded = ref(false)

  function attach(target: Clock) {
    clock = markRaw(target)
    clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER
    clock.shouldAnimate = playing.value
    clock.multiplier = multiplier.value
    // A range set before the viewer existed (restored runs) applies once the clock is here.
    if (bounded.value) setRange(startMs.value, stopMs.value, false)
    else sync()
  }

  function detach() {
    clock = null
  }

  function sync() {
    if (!clock) return
    currentMs.value = JulianDate.toDate(clock.currentTime).getTime()
    playing.value = clock.shouldAnimate
    multiplier.value = clock.multiplier
    if (!bounded.value) {
      startMs.value = currentMs.value - HALF_DAY_MS
      stopMs.value = currentMs.value + HALF_DAY_MS
    }
  }

  function seek(ms: number) {
    if (!clock) return
    clock.currentTime = JulianDate.fromDate(new Date(ms))
    sync()
  }

  function setPlaying(value: boolean) {
    if (!clock) return
    clock.shouldAnimate = value
    sync()
  }

  function setMultiplier(value: number) {
    if (!clock) return
    clock.multiplier = value
    sync()
  }

  /** Clamp playback to a propagation window, optionally jumping to its start. */
  function setRange(start: number, stop: number, jump = true) {
    startMs.value = start
    stopMs.value = stop
    bounded.value = true
    if (!clock) return
    clock.startTime = JulianDate.fromDate(new Date(start))
    clock.stopTime = JulianDate.fromDate(new Date(stop))
    clock.clockRange = ClockRange.CLAMPED
    const now = JulianDate.toDate(clock.currentTime).getTime()
    if (jump || now < start || now > stop) clock.currentTime = clock.startTime.clone()
    sync()
  }

  function clearRange() {
    bounded.value = false
    if (clock) clock.clockRange = ClockRange.UNBOUNDED
    sync()
  }

  /** Seek to ``ms``, lifting the playback range first if it would clamp the jump. */
  function reveal(ms: number) {
    if (bounded.value && (ms < startMs.value || ms > stopMs.value)) clearRange()
    seek(ms)
  }

  function goLive() {
    clearRange()
    seek(Date.now())
    setMultiplier(1)
    setPlaying(true)
  }

  return {
    currentMs,
    startMs,
    stopMs,
    playing,
    multiplier,
    bounded,
    attach,
    detach,
    sync,
    seek,
    setPlaying,
    setMultiplier,
    setRange,
    clearRange,
    reveal,
    goLive,
  }
})
