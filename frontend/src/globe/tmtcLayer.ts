import {
  CallbackPositionProperty,
  Cartesian3,
  Color,
  JulianDate,
  ReferenceFrame,
  type Entity,
  type Viewer,
} from 'cesium'
import { computed, watch } from 'vue'
import type { TmtcContact } from '../api/types'
import { contactInFocus } from '../mission/tmtcLog'
import { useClockStore } from '../stores/clock'
import { useLayersStore } from '../stores/layers'
import { passKey, usePassesStore } from '../stores/passes'
import { useTmtcStore } from '../stores/tmtc'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import { formatUtc } from '../utils/time'
import { addBand, addEndPin, addLineOfSight, trackPositions } from './contactGraphics'
import { PULSE_MS, pulsePosition } from './linkPulse'
import { interpolateTrack } from './passTrack'

type Dir = 'up' | 'down'

/** Pass prediction and the session compute the same pass; their AOS agree to within this. */
const SAME_PASS_MS = 60_000

interface Link {
  stationId: number
  ground: Cartesian3
  contacts: readonly TmtcContact[]
}

/**
 * The simulated TC/TM link on the globe: a solid line from each station of the session to
 * the spacecraft while their contact is on (pass prediction draws the same sight dashed),
 * a dot running along it whenever packets go up or come down, and the contact in progress
 * or next to come as a band from AOS to LOS, so a jump to the next AOS shows where it landed.
 */
export function useTmtcLayer(viewer: Viewer) {
  const tmtc = useTmtcStore()
  const passes = usePassesStore()
  const layers = useLayersStore()
  const theme = useThemePreset()
  const clock = useClockStore()
  let entities: Entity[] = []
  let focusEntities: Entity[] = []
  let links: Link[] = []
  // Wall-clock start of the dot in flight per direction; the dot's place on the link is
  // animation, while the link's ends still come from the Cesium clock.
  const launched: Record<Dir, number> = { up: -Infinity, down: -Infinity }

  function clear() {
    entities.forEach((entity) => viewer.entities.remove(entity))
    entities = []
    links = []
  }

  function clearFocus() {
    focusEntities.forEach((entity) => viewer.entities.remove(entity))
    focusEntities = []
  }

  function stationColor(stationId: number): Color {
    const palette = theme.preset.globe.stationPalette
    return Color.fromCssColorString(stationColorHex(passes.colorIndexOf(stationId), palette))
  }

  /** Whether the pass layer already draws this contact, band and pins included. */
  function drawnByPasses(contact: TmtcContact): boolean {
    return passes.timeline.some(
      ({ pass, station }) =>
        station.id === contact.station_id &&
        pass.status === 'assigned' &&
        passes.isSelected(station.id) &&
        passes.isPassVisible(passKey(pass)) &&
        Math.abs(Date.parse(pass.aos) - contact.aos_ms) < SAME_PASS_MS,
    )
  }

  const focus = computed(() => contactInFocus(tmtc.view.contacts, clock.currentMs))

  function renderFocus() {
    clearFocus()
    const contact = focus.value
    if (!layers.prefs.showStations || !contact || contact.track_fixed_m.length < 6) return
    if (drawnByPasses(contact)) return
    const color = stationColor(contact.station_id)
    const positions = trackPositions(contact.track_fixed_m)
    const key = `${contact.station_id}:${contact.aos_ms}`
    const pin = (end: 'aos' | 'los', position: Cartesian3) => {
      const time = formatUtc(end === 'aos' ? contact.aos_ms : contact.los_ms).slice(11)
      const text = `TC/TM ${end.toUpperCase()} ${time}`
      return addEndPin(viewer, `tmtc-pass-end:${key}:${end}`, position, color, text, end)
    }
    focusEntities = [
      addBand(viewer, `tmtc-pass:${key}`, positions, color),
      pin('aos', positions[0]!),
      pin('los', positions[positions.length - 1]!),
    ]
  }

  function render() {
    clear()
    const contacts = tmtc.view.contacts
    if (!layers.prefs.showStations || !contacts.length) return
    const byStation = new Map<number, TmtcContact[]>()
    for (const contact of contacts) {
      if (contact.track_fixed_m.length < 6) continue
      byStation.set(contact.station_id, [...(byStation.get(contact.station_id) ?? []), contact])
    }
    for (const [stationId, own] of byStation) {
      // A station deleted since the session started has nowhere to draw from.
      const station = passes.stations.find((item) => item.id === stationId)
      if (!station) continue
      const ground = Cartesian3.fromDegrees(station.lon_deg, station.lat_deg, station.alt_m)
      const color = stationColor(stationId)
      const tracks = own.map((contact) => ({
        aosMs: contact.aos_ms,
        losMs: contact.los_ms,
        track: contact.track_fixed_m,
      }))
      links.push({ stationId, ground, contacts: own })
      entities.push(addLineOfSight(viewer, `tmtc-sight:${stationId}`, ground, tracks, color, false))
    }
    if (!links.length) return
    const { up, down } = theme.preset.globe.link
    entities.push(dot('up', Color.fromCssColorString(up)))
    entities.push(dot('down', Color.fromCssColorString(down)))
  }

  /** Both ends of the link at ``ms``, preferring the station the simulator talks through. */
  function endsAt(ms: number): { ground: Cartesian3; satellite: [number, number, number] } | null {
    const serving = tmtc.view.link?.station_id
    const ordered = [...links].sort(
      (a, b) => Number(b.stationId === serving) - Number(a.stationId === serving),
    )
    for (const link of ordered) {
      for (const contact of link.contacts) {
        const at = interpolateTrack(contact.track_fixed_m, contact.aos_ms, contact.los_ms, ms)
        if (at) return { ground: link.ground, satellite: at }
      }
    }
    return null
  }

  function dot(dir: Dir, color: Color): Entity {
    const position = new CallbackPositionProperty(
      (time, result) => {
        const elapsed = performance.now() - launched[dir]
        if (!time || elapsed > PULSE_MS) return undefined
        const ends = endsAt(JulianDate.toDate(time).getTime())
        if (!ends) return undefined
        const { x, y, z } = ends.ground
        const at = pulsePosition([x, y, z], ends.satellite, dir, elapsed)
        return at ? Cartesian3.fromElements(at[0], at[1], at[2], result) : undefined
      },
      false,
      ReferenceFrame.FIXED,
    )
    return viewer.entities.add({
      id: `tmtc-pulse:${dir}`,
      position,
      point: { pixelSize: 8, color, outlineColor: Color.WHITE, outlineWidth: 1.5 },
    })
  }

  watch(
    () => [tmtc.view.contacts, passes.stations, layers.prefs.showStations, theme.preset.id],
    render,
    { immediate: true },
  )

  watch(
    () => [
      focus.value,
      passes.timeline,
      passes.hidden,
      passes.selectedIds,
      layers.prefs.showStations,
      theme.preset.id,
    ],
    renderFocus,
    { immediate: true },
  )

  // A dot in flight finishes before the next leaves, so fast playback does not flicker.
  watch(
    () => tmtc.pulse,
    (now, before) => {
      const wall = performance.now()
      for (const dir of ['up', 'down'] as const) {
        if (now[dir] !== before[dir] && wall - launched[dir] > PULSE_MS) launched[dir] = wall
      }
    },
  )

  return {
    dispose() {
      clear()
      clearFocus()
    },
  }
}
