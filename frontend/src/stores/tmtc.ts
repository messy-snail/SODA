import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef, watch } from 'vue'
import { api, tmtcSocketUrl } from '../api/client'
import type { TmtcCommand, TmtcMessage } from '../api/types'
import { applyMessages, emptyView, type TmtcView } from '../mission/tmtcLog'
import { refParams, type SatelliteRef } from '../utils/satelliteRef'
import { useClockStore } from './clock'

/** Clock updates sent to the simulator at most this often. */
const CLOCK_THROTTLE_MS = 250

/**
 * The simulated TC/TM link. The server runs the spacecraft; this store starts a session,
 * feeds it the Cesium clock (the simulation time, invariant 9) and keeps what comes back.
 */
export const useTmtcStore = defineStore('tmtc', () => {
  const clock = useClockStore()
  const view = shallowRef<TmtcView>(emptyView())
  const name = ref('')
  const loading = ref(false)
  const error = ref<unknown>(null)
  const connected = ref(false)
  /** Packets received by direction; the globe sends a dot along the link when one changes. */
  const pulse = shallowRef({ up: 0, down: 0 })
  let socket: WebSocket | null = null
  let lastSent = 0
  let pending: ReturnType<typeof setTimeout> | null = null

  function receive(messages: TmtcMessage[]) {
    view.value = markRaw(applyMessages(view.value, messages))
    let { up, down } = pulse.value
    for (const message of messages) {
      if (message.type !== 'packet') continue
      if (message.dir === 'up') up += 1
      else down += 1
    }
    if (up !== pulse.value.up || down !== pulse.value.down) pulse.value = { up, down }
  }

  function sendClock() {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'clock', ms: Math.round(clock.currentMs) }))
    lastSent = Date.now()
  }

  // Wall-clock throttling of how often the simulation time is reported, not a time source.
  watch(
    () => clock.currentMs,
    () => {
      if (!connected.value || pending) return
      const wait = Math.max(0, CLOCK_THROTTLE_MS - (Date.now() - lastSent))
      pending = setTimeout(() => {
        pending = null
        sendClock()
      }, wait)
    },
  )

  function connect() {
    socket?.close()
    const own = new WebSocket(tmtcSocketUrl(location))
    socket = own
    own.onopen = () => {
      connected.value = true
      sendClock()
    }
    own.onmessage = (event) => receive([JSON.parse(String(event.data)) as TmtcMessage])
    own.onclose = () => {
      if (socket === own) connected.value = false
    }
  }

  async function start(
    run: SatelliteRef & { startMs: number; stopMs: number },
    stations: number[],
  ) {
    loading.value = true
    error.value = null
    try {
      const status = await api.tmtcStart({
        ...refParams(run),
        start: new Date(run.startMs).toISOString(),
        end: new Date(run.stopMs).toISOString(),
        station_ids: stations,
      })
      name.value = status.name
      view.value = markRaw(applyMessages(emptyView(), [status]))
      connect()
    } catch (caught) {
      error.value = caught
    } finally {
      loading.value = false
    }
  }

  async function stop() {
    try {
      await api.tmtcStop()
    } catch (caught) {
      error.value = caught
    }
    socket?.close()
    socket = null
    connected.value = false
    view.value = emptyView()
  }

  /** Picks up a session started earlier (another tab, or before a reload). */
  async function resume() {
    try {
      const status = await api.tmtcStatus()
      if (status.type === 'status') {
        name.value = status.name
        view.value = markRaw(applyMessages(emptyView(), [status]))
        connect()
      }
    } catch {
      // No server yet: the tab simply shows no session.
    }
  }

  function send(command: TmtcCommand) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'tc', command }))
  }

  return { view, name, loading, error, connected, pulse, start, stop, resume, send }
})
