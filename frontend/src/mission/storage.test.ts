import { describe, expect, it } from 'vitest'
import type { RecorderResult } from './recorder'
import {
  defaultStorageSettings,
  formatGbit,
  GBIT,
  isDownlinkStation,
  MBPS,
  sanitizeStorageSettings,
  setStationMode,
  setStationRate,
  stationLink,
  STORAGE_LIMITS,
  storageModel,
  storageStatLevels,
} from './storage'

describe('sanitizeStorageSettings', () => {
  it('keeps valid fields and replaces the rest', () => {
    const settings = sanitizeStorageSettings({
      capacityGbit: 64,
      initialGbit: -1,
      imagingMbps: 'fast',
      shotS: 5,
      compressionRatio: 4,
      lockS: 9999,
      playback: 'priority',
      urgentTargetIds: ['aoi-1', 7, 'aoi-1', ''],
      noDownlinkStationIds: [3, 'x', 4.5, 7],
    })
    expect(settings).toEqual({
      ...defaultStorageSettings(),
      capacityGbit: 64,
      shotS: 5,
      compressionRatio: 4,
      playback: 'priority',
      urgentTargetIds: ['aoi-1'],
      noDownlinkStationIds: [3, 7],
    })
    expect(sanitizeStorageSettings(null)).toEqual(defaultStorageSettings())
  })

  it('carries the old single downlink rate over as the X-band rate', () => {
    expect(sanitizeStorageSettings({ downlinkMbps: 150 }).xMbps).toBe(150)
    expect(sanitizeStorageSettings({ downlinkMbps: 150, xMbps: 800 }).xMbps).toBe(800)
    expect(sanitizeStorageSettings({ downlinkMbps: 0 }).xMbps).toBe(defaultStorageSettings().xMbps)
  })

  it('drops station links that are broken or repeated', () => {
    const settings = sanitizeStorageSettings({
      stationLinks: [
        { stationId: 1, band: 's', rateMbps: null },
        { stationId: 1, band: 'x', rateMbps: 100 },
        { stationId: 2, band: 'ka', rateMbps: null },
        { stationId: 3, band: 'x', rateMbps: -5 },
        { stationId: 4.5, band: 'x', rateMbps: 10 },
        { stationId: 5, band: 'x', rateMbps: 120 },
        'x',
      ],
    })
    expect(settings.stationLinks).toEqual([
      { stationId: 1, band: 's', rateMbps: null },
      { stationId: 5, band: 'x', rateMbps: 120 },
    ])
  })
})

describe('storageModel', () => {
  it('turns the settings into bits, with compression shrinking each image', () => {
    const model = storageModel({ ...defaultStorageSettings(), compressionRatio: 4 })
    expect(model).toMatchObject({
      capacityBits: 512 * GBIT,
      initialBits: 0,
      imageBps: 250 * MBPS,
      xMinElevDeg: 5,
      lockS: 10,
      priority: false,
    })
  })

  it('takes the lower limit for a half-typed field', () => {
    const model = storageModel({ ...defaultStorageSettings(), capacityGbit: Number.NaN })
    expect(model.capacityBits).toBe(STORAGE_LIMITS.capacityGbit[0] * GBIT)
  })
})

describe('station links', () => {
  it('defaults to X-band at the X-band rate', () => {
    const settings = defaultStorageSettings()
    expect(stationLink(settings, 9)).toEqual({
      on: true,
      band: 'x',
      rateBps: 300 * MBPS,
      ownRate: false,
    })
    expect(isDownlinkStation(settings, 9)).toBe(true)
  })

  it('switches a station to S-band, off and back without losing its rate', () => {
    const settings = defaultStorageSettings()
    setStationMode(settings, 9, 's')
    expect(stationLink(settings, 9)).toMatchObject({ on: true, band: 's', rateBps: 2 * MBPS })
    setStationRate(settings, 9, 4)
    setStationMode(settings, 9, 'off')
    expect(isDownlinkStation(settings, 9)).toBe(false)
    expect(settings.noDownlinkStationIds).toEqual([9])
    setStationMode(settings, 9, 's')
    expect(stationLink(settings, 9)).toEqual({
      on: true,
      band: 's',
      rateBps: 4 * MBPS,
      ownRate: true,
    })
    expect(settings.noDownlinkStationIds).toEqual([])
  })

  it('lists only stations that differ from the default', () => {
    const settings = defaultStorageSettings()
    setStationRate(settings, 9, 150)
    expect(settings.stationLinks).toEqual([{ stationId: 9, band: 'x', rateMbps: 150 }])
    setStationRate(settings, 9, null)
    expect(settings.stationLinks).toEqual([])
  })
})

describe('storageStatLevels', () => {
  const result = (peakBits: number, lostCount: number) =>
    ({ peakBits, lostCount }) as RecorderResult

  it('warns from 90% fill and flags an image that was not stored', () => {
    expect(storageStatLevels(result(89, 0), 100)).toEqual({ peak: null, lost: null })
    expect(storageStatLevels(result(90, 0), 100)).toEqual({ peak: 'warning', lost: null })
    expect(storageStatLevels(result(100, 2), 100)).toEqual({ peak: 'warning', lost: 'error' })
  })
})

describe('formatGbit', () => {
  it('keeps the decimals a value of that size is worth', () => {
    expect(formatGbit(0)).toBe('0.00')
    expect(formatGbit(1.234 * GBIT)).toBe('1.23')
    expect(formatGbit(12.34 * GBIT)).toBe('12.3')
    expect(formatGbit(512 * GBIT)).toBe('512')
  })
})
