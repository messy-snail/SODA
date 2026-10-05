import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PowerResponse } from '../api/types'
import {
  defaultPowerSettings,
  levelAt,
  POWER_LIMITS,
  powerModel,
  powerPoints,
  powerStatLevels,
  powerSettingsValid,
  sanitizePowerSettings,
  spansMs,
} from './power'

describe('power settings', () => {
  it('repairs stored settings field by field', () => {
    const fallback = defaultPowerSettings()
    expect(sanitizePowerSettings(null)).toEqual(fallback)
    expect(
      sanitizePowerSettings({ arrayW: 80, capacityWh: -1, slewS: 'x', contactAttitude: 'yaw' }),
    ).toEqual({ ...fallback, arrayW: 80 })
    expect(sanitizePowerSettings({ contactAttitude: 'station' }).contactAttitude).toBe('station')
  })

  it('holds a request back while a field is half typed', () => {
    const settings = defaultPowerSettings()
    expect(powerSettingsValid(settings)).toBe(true)
    expect(powerSettingsValid({ ...settings, arrayW: '' as unknown as number })).toBe(false)
    expect(powerSettingsValid({ ...settings, chargeEffPct: 20 })).toBe(false)
  })

  it('sends the equivalent circuit only when it is the chosen model', () => {
    const settings = defaultPowerSettings()
    expect(powerModel(settings).battery).toBeUndefined()
    const circuit = { ...settings, batteryKind: 'circuit' as const }
    expect(powerModel(circuit).battery).toMatchObject({ cells_series: 8, capacity_ah: 70 })
    expect(powerSettingsValid({ ...circuit, battery: { ...circuit.battery, cellMinV: 5 } })).toBe(
      false,
    )
    // The circuit's fields do not matter while the energy model is chosen.
    expect(powerSettingsValid({ ...settings, battery: { ...settings.battery, cellMinV: 5 } })).toBe(
      true,
    )
    expect(sanitizePowerSettings({ batteryKind: 'circuit' }).batteryKind).toBe('circuit')
  })

  it('sends efficiencies as fractions and the rest as entered', () => {
    const model = powerModel({ ...defaultPowerSettings(), chargeEffPct: 85, dischargeEffPct: 95 })
    expect(model.charge_efficiency).toBeCloseTo(0.85)
    expect(model.discharge_efficiency).toBeCloseTo(0.95)
    expect(model).toMatchObject({ array_w: 1300, dod_limit_pct: 30, contact_attitude: 'sun' })
  })

  it('keeps the same ranges as the request model on the server', () => {
    const schema = readFileSync(resolve(process.cwd(), '../src/soda/api/schemas.py'), 'utf8')
    const model = schema.slice(schema.indexOf('class PowerModel'), schema.indexOf('def spec('))
    const upper = (field: string) => {
      const match = new RegExp(`${field}: float = Field\\(([^)]*)\\)`).exec(model)
      const limit = /le=([0-9e.]+)/.exec(match?.[1] ?? '')
      return Number(limit?.[1])
    }
    expect(upper('array_w')).toBe(POWER_LIMITS.arrayW[1])
    expect(upper('capacity_wh')).toBe(POWER_LIMITS.capacityWh[1])
    expect(upper('base_w')).toBe(POWER_LIMITS.baseW[1])
    expect(upper('slew_s')).toBe(POWER_LIMITS.slewS[1])
    // Efficiencies travel as fractions.
    expect(upper('charge_efficiency') * 100).toBe(POWER_LIMITS.chargeEffPct[1])
  })
})

describe('power response', () => {
  const response = {
    start: '2026-09-16T00:00:00.000Z',
    time_s: [0, 60, 600],
    soc: [1, 0.9, 1],
    eclipse_s: [10, 50, 300, 400],
  } as PowerResponse
  const startMs = Date.parse(response.start)

  it('puts the stored energy on the clock axis', () => {
    expect(powerPoints(response)).toEqual([
      { ms: startMs, value: 1 },
      { ms: startMs + 60_000, value: 0.9 },
      { ms: startMs + 600_000, value: 1 },
    ])
  })

  it('reads the level between vertices and nothing outside them', () => {
    const points = powerPoints(response)
    expect(levelAt(points, startMs + 30_000)).toBeCloseTo(0.95)
    expect(levelAt(points, startMs + 60_000)).toBe(0.9)
    expect(levelAt(points, startMs + 600_000)).toBe(1)
    expect(levelAt(points, startMs - 1)).toBeNull()
    expect(levelAt(points, startMs + 600_001)).toBeNull()
    expect(levelAt([], startMs)).toBeNull()
  })

  it('reads flat second pairs as spans', () => {
    expect(spansMs(response.eclipse_s, response.start)).toEqual([
      { startMs: startMs + 10_000, endMs: startMs + 50_000 },
      { startMs: startMs + 300_000, endMs: startMs + 400_000 },
    ])
    expect(spansMs([5], response.start)).toEqual([])
  })
})

describe('powerStatLevels', () => {
  const base = {
    soc: [1, 0.8, 1],
    max_dod: 0.2,
    final_soc: 1,
    unmet_wh: 0,
  } as PowerResponse

  it('leaves a healthy budget untinted, including a depth exactly at the limit', () => {
    expect(powerStatLevels(base, 30, 0.9)).toEqual({ depth: null, final: null, now: null })
    expect(powerStatLevels(base, 20, 0.8)).toEqual({ depth: null, final: null, now: null })
  })

  it('warns past the depth limit, at the end of the run and at the clock too', () => {
    expect(powerStatLevels({ ...base, max_dod: 0.35 }, 30, 0.6)).toMatchObject({
      depth: 'warning',
      now: 'warning',
    })
    expect(powerStatLevels({ ...base, max_dod: 0.35, final_soc: 0.65 }, 30, null).final).toBe(
      'warning',
    )
    // Ending a little under the start, inside the limit, is what a run cut in an eclipse does.
    expect(powerStatLevels({ ...base, final_soc: 0.95 }, 30, null).final).toBeNull()
  })

  it('marks an empty battery as an error', () => {
    const flat = { ...base, max_dod: 1, final_soc: 0, unmet_wh: 12 }
    expect(powerStatLevels(flat, 30, 0)).toEqual({ depth: 'error', final: 'error', now: 'error' })
  })

  it('has nothing to say about the clock outside the simulated span', () => {
    expect(powerStatLevels({ ...base, max_dod: 0.35 }, 30, null).now).toBeNull()
  })
})
