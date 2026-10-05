import type { TimelineEntry } from '../stores/passes'
import { usePassesStore } from '../stores/passes'
import { useRunsStore } from '../stores/runs'
import { stationColorHex } from '../theme/stationColors'
import { orbitColorHex } from '../theme/runColors'
import { useThemePreset } from '../theme/useThemePreset'
import { satKey } from './satelliteRef'

/**
 * Colour of a pass wherever it is drawn. With one satellite passes are told apart by
 * station, as they always were; with several, by satellite (its orbit's colour).
 */
export function usePassColors() {
  const passes = usePassesStore()
  const runs = useRunsStore()
  const theme = useThemePreset()

  function satelliteColor(index: number): string {
    const run = runs.runs.find((item) => satKey(item) === passes.resultSatKeys[index])
    return orbitColorHex(run?.colorIndex ?? index, theme.preset.globe.orbitPalette)
  }

  function passColor(entry: Pick<TimelineEntry, 'colorIndex' | 'satelliteIndex'>): string {
    return passes.multi
      ? satelliteColor(entry.satelliteIndex)
      : stationColorHex(entry.colorIndex, theme.preset.globe.stationPalette)
  }

  return { satelliteColor, passColor }
}
