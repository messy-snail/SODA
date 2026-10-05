import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRAVITY_DEGREE,
  HPOP_MAX_EPOCH_GAP_DAYS,
  HPOP_MAX_SPAN_DAYS,
  MAX_GRAVITY_DEGREE,
  defaultHpopForm,
  effectivePropagator,
  epochGapDays,
  hpopFormValid,
  hpopRequest,
  hpopWindowProblem,
  overlapsSpan,
  propagatorLabel,
} from './propagatorOptions'

const DAY = 86_400_000
const EPOCH = Date.UTC(2026, 8, 15)

describe('hpopRequest', () => {
  it('leaves blank spacecraft fields out so the server estimates them', () => {
    expect(hpopRequest(defaultHpopForm())).toEqual({
      gravity_degree: DEFAULT_GRAVITY_DEGREE,
      third_body: true,
      drag: true,
      srp: true,
    })
  })

  it('sends one area for both drag and radiation pressure', () => {
    const form = { ...defaultHpopForm(), massKg: '420', areaM2: ' 3.5 ', cd: '2.2', cr: '1.2' }
    expect(hpopRequest(form)).toMatchObject({
      mass_kg: 420,
      drag_area_m2: 3.5,
      srp_area_m2: 3.5,
      cd: 2.2,
      cr: 1.2,
    })
  })

  it('keeps the gravity degree inside what the bundled field has', () => {
    expect(hpopRequest({ ...defaultHpopForm(), gravityDegree: 99 }).gravity_degree).toBe(20)
    expect(hpopRequest({ ...defaultHpopForm(), gravityDegree: 0 }).gravity_degree).toBe(2)
  })

  it('drops values that are not positive numbers', () => {
    const form = { ...defaultHpopForm(), massKg: '-5', cd: 'abc' }
    expect(hpopFormValid(form)).toBe(false)
    expect(hpopRequest(form)).not.toHaveProperty('mass_kg')
    expect(hpopFormValid(defaultHpopForm())).toBe(true)
  })
})

describe('hpopWindowProblem', () => {
  it('measures the gap to the nearest window edge', () => {
    expect(epochGapDays(EPOCH, EPOCH - DAY, EPOCH + DAY)).toBe(0)
    expect(epochGapDays(EPOCH, EPOCH + 2 * DAY, EPOCH + 3 * DAY)).toBe(2)
    expect(epochGapDays(EPOCH, EPOCH - 5 * DAY, EPOCH - 3 * DAY)).toBe(3)
  })

  it('accepts windows at the limits and refuses those beyond', () => {
    expect(hpopWindowProblem(EPOCH, EPOCH, EPOCH + 7 * DAY)).toBeNull()
    expect(hpopWindowProblem(EPOCH, EPOCH, EPOCH + 7 * DAY + 1)).toBe('span')
    expect(hpopWindowProblem(EPOCH, EPOCH + 7 * DAY, EPOCH + 8 * DAY)).toBeNull()
    expect(hpopWindowProblem(EPOCH, EPOCH + 7 * DAY + 1, EPOCH + 8 * DAY)).toBe('epoch')
    expect(hpopWindowProblem(EPOCH, EPOCH - 9 * DAY, EPOCH - 8 * DAY)).toBe('epoch')
  })
})

describe('limits', () => {
  it('match the backend constants', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../src/soda/orbit/hpop/constants.py'),
      'utf8',
    )
    const constant = (pattern: RegExp) => Number(pattern.exec(source)?.[1])
    expect(constant(/HPOP_MAX_SPAN = timedelta\(days=(\d+)\)/)).toBe(HPOP_MAX_SPAN_DAYS)
    expect(constant(/HPOP_MAX_EPOCH_GAP = timedelta\(days=(\d+)\)/)).toBe(HPOP_MAX_EPOCH_GAP_DAYS)
    expect(constant(/MAX_GRAVITY_DEGREE = (\d+)/)).toBe(MAX_GRAVITY_DEGREE)
    expect(constant(/DEFAULT_GRAVITY_DEGREE = (\d+)/)).toBe(DEFAULT_GRAVITY_DEGREE)
  })
})

describe('effectivePropagator', () => {
  it('integrates a state vector whatever the form says', () => {
    expect(effectivePropagator('state', 'sgp4')).toBe('hpop')
    expect(effectivePropagator('elements', 'sgp4')).toBe('sgp4')
    expect(effectivePropagator(null, 'hpop')).toBe('hpop')
  })

  it('reads an ephemeris instead of propagating it', () => {
    expect(effectivePropagator('ephemeris', 'sgp4')).toBe('ephemeris')
    expect(effectivePropagator('ephemeris', 'hpop')).toBe('ephemeris')
    expect(['sgp4', 'hpop', 'ephemeris'].map((p) => propagatorLabel(p as 'sgp4'))).toEqual([
      'SGP4',
      'HPOP',
      'OEM',
    ])
  })

  it('tells whether a window touches a file span', () => {
    expect(overlapsSpan(0, 10, 10, 20)).toBe(true)
    expect(overlapsSpan(5, 15, 10, 20)).toBe(true)
    expect(overlapsSpan(21, 30, 10, 20)).toBe(false)
    expect(overlapsSpan(0, 9, 10, 20)).toBe(false)
  })
})
