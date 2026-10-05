import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BATTERY_LIMITS,
  batteryModel,
  batterySettingsValid,
  DEFAULT_OCV,
  defaultBatterySettings,
  formatOcv,
  MAX_OCV_POINTS,
  ocvProblem,
  parseOcv,
  sanitizeBatterySettings,
} from './battery'

describe('open-circuit voltage curve', () => {
  it('round-trips through the text it is typed as', () => {
    const text = formatOcv(DEFAULT_OCV)
    expect(text.split('\n')[1]).toBe('5, 3.3')
    expect(parseOcv(text)).toEqual({ points: DEFAULT_OCV, problem: null })
  })

  it('reads pasted columns and skips blank lines', () => {
    expect(parseOcv('0\t3.0\n\n50; 3.7\n 100   4.2 \n').points).toEqual([
      { socPct: 0, cellV: 3.0 },
      { socPct: 50, cellV: 3.7 },
      { socPct: 100, cellV: 4.2 },
    ])
  })

  it('says what is wrong with a curve', () => {
    expect(parseOcv('0, 3.0\nhalf, 3.7').problem).toBe('format')
    expect(parseOcv('0, 3.0, 9\n100, 4.2').problem).toBe('format')
    expect(parseOcv('0, 3.0').problem).toBe('count')
    expect(parseOcv('0, 3.0\n120, 4.2').problem).toBe('range')
    expect(parseOcv('0, 0\n100, 4.2').problem).toBe('range')
    expect(parseOcv('10, 3.0\n100, 4.2').problem).toBe('ends')
    expect(parseOcv('0, 3.0\n50, 3.5\n50, 3.6\n100, 4.2').problem).toBe('order')
    expect(parseOcv('0, 3.0\n50, 3.8\n100, 3.7').problem).toBe('falling')
    const many = Array.from({ length: MAX_OCV_POINTS + 1 }, (_, i) => ({
      socPct: (i * 100) / MAX_OCV_POINTS,
      cellV: 3 + i * 0.01,
    }))
    expect(ocvProblem(many)).toBe('count')
    expect(ocvProblem(many.slice(0, 2).concat(many.slice(-1)))).toBeNull()
  })
})

describe('battery settings', () => {
  it('repairs stored settings and falls back from a broken curve', () => {
    const fallback = defaultBatterySettings()
    expect(sanitizeBatterySettings(null)).toEqual(fallback)
    const ocv = [
      { socPct: 0, cellV: 2.8 },
      { socPct: 100, cellV: 4.1 },
    ]
    expect(sanitizeBatterySettings({ cellsSeries: 4, capacityAh: -1, ocv })).toEqual({
      ...fallback,
      cellsSeries: 4,
      ocv,
    })
    expect(sanitizeBatterySettings({ ocv: [{ socPct: 0, cellV: 4 }] }).ocv).toEqual(fallback.ocv)
  })

  it('holds a request back for a half-typed field or crossed voltage limits', () => {
    const settings = defaultBatterySettings()
    expect(batterySettingsValid(settings)).toBe(true)
    expect(batterySettingsValid({ ...settings, capacityAh: '' as unknown as number })).toBe(false)
    expect(batterySettingsValid({ ...settings, cellMinV: 4.2 })).toBe(false)
  })

  it('sends the resistance in ohms and the curve as named points', () => {
    const model = batteryModel(defaultBatterySettings())
    expect(model.resistance_ohm).toBeCloseTo(0.04)
    expect(model.ocv[1]).toEqual({ soc_pct: 5, cell_v: 3.3 })
    expect(model).toMatchObject({ cells_series: 8, capacity_ah: 70, cell_max_v: 4.2 })
  })

  it('matches the default curve and the limits of the server', () => {
    const source = readFileSync(resolve(process.cwd(), '../src/soda/orbit/battery.py'), 'utf8')
    const numbers = (name: string) =>
      new RegExp(`${name} = \\(([^)]*)\\)`)
        .exec(source)![1]!
        .split(',')
        .map((item) => Number(item))
    expect(numbers('DEFAULT_OCV_SOC').map((soc) => soc * 100)).toEqual(
      DEFAULT_OCV.map((point) => point.socPct),
    )
    expect(numbers('DEFAULT_OCV_CELL_V')).toEqual(DEFAULT_OCV.map((point) => point.cellV))
    expect(Number(/MAX_OCV_POINTS = (\d+)/.exec(source)![1])).toBe(MAX_OCV_POINTS)

    const schema = readFileSync(resolve(process.cwd(), '../src/soda/api/schemas.py'), 'utf8')
    const model = schema.slice(schema.indexOf('class BatteryModel'), schema.indexOf('def battery('))
    const upper = (field: string) =>
      Number(new RegExp(`${field}: \\w+ = Field\\([^)]*le=([0-9e.]+)`).exec(model)![1])
    expect(upper('cells_series')).toBe(BATTERY_LIMITS.cellsSeries[1])
    expect(upper('capacity_ah')).toBe(BATTERY_LIMITS.capacityAh[1])
    expect(upper('resistance_ohm') * 1000).toBe(BATTERY_LIMITS.resistanceMohm[1])
    expect(upper('max_charge_a')).toBe(BATTERY_LIMITS.maxChargeA[1])
    expect(upper('cell_max_v')).toBe(BATTERY_LIMITS.cellMaxV[1])
  })
})
