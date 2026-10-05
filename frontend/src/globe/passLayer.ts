import { Cartesian3, Color, type Entity, type Viewer } from 'cesium'
import { watch } from 'vue'
import type { Pass } from '../api/types'
import { useLayersStore } from '../stores/layers'
import { passKey, usePassesStore, type TimelineEntry } from '../stores/passes'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import { formatUtc } from '../utils/time'
import { usePassColors } from '../utils/usePassColors'
import {
  addBand,
  addEndPin,
  addLineOfSight,
  BAND_WIDTH_PX,
  trackPositions,
} from './contactGraphics'
import { splitAtWindow } from './passTrack'

/** Opacity of the stretch of a contact that lies outside the predicted window. */
const MARGIN_ALPHA = 0.2

/** A pass the station gave to a higher-priority satellite: faint, thin, no pins. */
const REJECTED_ALPHA = 0.2

/**
 * Each shown pass of the last prediction as a track from AOS to LOS, coloured by station
 * (one satellite) or by satellite (several), plus a dashed line of sight from each station
 * while it serves a pass. Passes dropped for a conflict stay as faint bands.
 */
export function usePassLayer(viewer: Viewer) {
  const passes = usePassesStore()
  const layers = useLayersStore()
  const theme = useThemePreset()
  const { passColor } = usePassColors()
  let entities: Entity[] = []

  function clear() {
    entities.forEach((entity) => viewer.entities.remove(entity))
    entities = []
  }

  function render() {
    clear()
    const result = passes.result
    if (!layers.prefs.showStations || !result) return
    const served = new Map<number, { station: TimelineEntry['station']; passes: Pass[] }>()
    // A station deselected since the prediction drops out, as its visibility area does.
    for (const entry of passes.timeline) {
      const { pass, station } = entry
      if (!passes.isSelected(station.id) || pass.track_fixed_m.length < 6) continue
      if (!passes.isPassVisible(passKey(pass))) continue
      const color = Color.fromCssColorString(passColor(entry))
      const positions = trackPositions(pass.track_fixed_m)
      if (pass.status === 'rejected') {
        const id = `pass:${passKey(pass)}`
        entities.push(addBand(viewer, id, positions, color, REJECTED_ALPHA, BAND_WIDTH_PX / 2))
        continue
      }
      const satellite = result.satellites[pass.satellite_index]
      const { before, inside, after } = splitAtWindow(
        positions.length,
        Date.parse(pass.aos),
        Date.parse(pass.los),
        satellite ? Date.parse(satellite.start) : passes.windowMs.start,
        satellite ? Date.parse(satellite.end) : passes.windowMs.end,
      )
      if (inside) {
        const inWindow = positions.slice(inside[0], inside[1] + 1)
        entities.push(addBand(viewer, `pass:${passKey(pass)}`, inWindow, color))
      }
      // The part of a pass outside the predicted window is kept but faded, so its pins
      // still sit on the real AOS/LOS at the edge of the visibility area.
      for (const [edge, range] of [
        ['before', before],
        ['after', after],
      ] as const) {
        if (range)
          entities.push(marginBand(pass, edge, positions.slice(range[0], range[1] + 1), color))
      }
      entities.push(
        endPin(pass, 'aos', positions[0]!, color),
        endPin(pass, 'los', positions[positions.length - 1]!, color),
      )
      const list = served.get(station.id) ?? { station, passes: [] }
      list.passes.push(pass)
      served.set(station.id, list)
    }
    const palette = theme.preset.globe.stationPalette
    for (const { station, passes: shown } of served.values()) {
      const color = Color.fromCssColorString(
        stationColorHex(passes.colorIndexOf(station.id), palette),
      )
      entities.push(lineOfSight(station, shown, color))
    }
  }

  function marginBand(
    pass: Pass,
    edge: 'before' | 'after',
    positions: Cartesian3[],
    color: Color,
  ): Entity {
    return addBand(viewer, `pass-margin:${passKey(pass)}:${edge}`, positions, color, MARGIN_ALPHA)
  }

  /**
   * ``#3 AOS 08:44:22`` at one end, with the satellite's name when there are several; an
   * end clipped by the search is hollow, ``▸``/``◂``.
   */
  function endPin(pass: Pass, end: 'aos' | 'los', position: Cartesian3, color: Color): Entity {
    const aos = end === 'aos'
    const clipped = aos ? pass.clipped_start : pass.clipped_end
    const tag = clipped ? (aos ? '▸' : '◂') : end.toUpperCase()
    const name = passes.multi ? ` ${passes.satelliteName(pass.satellite_index)}` : ''
    const time = formatUtc(Date.parse(pass[end])).slice(11)
    const text = `#${passes.numberOf(passKey(pass))}${name} ${tag} ${time}`
    const id = `pass-end:${passKey(pass)}:${end}`
    return addEndPin(viewer, id, position, color, text, end, clipped)
  }

  function lineOfSight(
    station: { id: number; lat_deg: number; lon_deg: number; alt_m: number },
    shown: Pass[],
    color: Color,
  ): Entity {
    const ground = Cartesian3.fromDegrees(station.lon_deg, station.lat_deg, station.alt_m)
    const contacts = shown.map((pass) => ({
      aosMs: Date.parse(pass.aos),
      losMs: Date.parse(pass.los),
      track: pass.track_fixed_m,
    }))
    return addLineOfSight(viewer, `pass-sight:${station.id}`, ground, contacts, color)
  }

  watch(
    () => [
      passes.result,
      passes.windowMs,
      passes.hidden,
      passes.selectedIds,
      layers.prefs.showStations,
      theme.preset.id,
    ],
    render,
    { immediate: true },
  )

  return { dispose: clear }
}
