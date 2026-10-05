import type { APIRequestContext } from '@playwright/test'
import { STATION_PRESETS } from '../src/stations/presets'

/**
 * Makes sure the station from preset `presetId` exists on the live server, since the
 * database is the user's and only a fresh one is seeded. Returns a cleanup that removes
 * the station again if this call added it.
 */
export async function ensurePresetStation(
  request: APIRequestContext,
  presetId: string,
): Promise<() => Promise<void>> {
  const stations = (await (await request.get('/api/v1/stations')).json()) as {
    preset_id: string | null
  }[]
  if (stations.some((station) => station.preset_id === presetId)) return async () => {}
  const preset = STATION_PRESETS.find((item) => item.id === presetId)
  if (!preset) throw new Error(`unknown station preset ${presetId}`)
  const response = await request.post('/api/v1/stations', {
    data: {
      name: preset.name.ko,
      lat_deg: preset.lat_deg,
      lon_deg: preset.lon_deg,
      alt_m: preset.alt_m,
      min_elev_deg: preset.min_elev_deg,
      preset_id: preset.id,
    },
  })
  if (!response.ok()) throw new Error(`adding ${presetId} failed: ${response.status()}`)
  const { id } = (await response.json()) as { id: number }
  return async () => {
    await request.delete(`/api/v1/stations/${id}`)
  }
}
