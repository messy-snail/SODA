import { describe, expect, it } from 'vitest'
import {
  customKind,
  hasElements,
  parseSatKey,
  refParams,
  sameSatellite,
  satKey,
  targetRun,
} from './satelliteRef'

describe('satellite refs', () => {
  const iss = { noradId: 25544, customId: null }
  const pasted = { noradId: 25544, customId: 3 }

  it('keeps a pasted element set apart from the catalog object with its number', () => {
    expect(satKey(iss)).toBe('norad:25544')
    expect(satKey(pasted)).toBe('custom:3')
    expect(sameSatellite(iss, pasted)).toBe(false)
    expect(sameSatellite(pasted, { noradId: 1, customId: 3 })).toBe(true)
  })

  it('names exactly one id for the API', () => {
    expect(refParams(iss)).toEqual({ norad_id: 25544 })
    expect(refParams(pasted)).toEqual({ custom_id: 3 })
  })

  it('reads keys back and rejects anything else', () => {
    expect(parseSatKey('norad:25544')).toEqual(iss)
    expect(parseSatKey('custom:3')).toEqual({ noradId: 0, customId: 3 })
    expect(parseSatKey('25544')).toBeNull()
    expect(parseSatKey('custom:x')).toBeNull()
  })

  it('keeps a state vector apart from saved elements with the same id', () => {
    const state = { noradId: 0, customId: 3, kind: 'state' as const }
    expect(satKey(state)).toBe('state:3')
    expect(sameSatellite(state, pasted)).toBe(false)
    expect(refParams(state)).toEqual({ state_id: 3 })
    expect(parseSatKey('state:3')).toEqual(state)
    expect(customKind(state)).toBe('state')
    expect(customKind(pasted)).toBe('elements')
    expect(customKind({ ...pasted, kind: 'elements' })).toBe('elements')
    expect(customKind(iss)).toBeNull()
    expect(satKey({ ...pasted, kind: 'elements' })).toBe('custom:3')
  })

  it('keeps an imported ephemeris apart as well', () => {
    const table = { noradId: 0, customId: 3, kind: 'ephemeris' as const }
    expect(satKey(table)).toBe('oem:3')
    expect(refParams(table)).toEqual({ ephemeris_id: 3 })
    expect(parseSatKey('oem:3')).toEqual(table)
    expect(hasElements(table)).toBe(false)
  })

  it('knows which satellites have elements', () => {
    const state = { noradId: 0, customId: 3, kind: 'state' as const }
    expect([iss, pasted, state].map(hasElements)).toEqual([true, true, false])
  })

  it('picks the run a tool works on: the selected one when usable, else the first usable', () => {
    const state = { noradId: 0, customId: 3, kind: 'state' as const }
    const all = [state, pasted, iss]
    // A tool that needs elements passes over a selected state vector.
    expect(targetRun(state, all, true)).toBe(pasted)
    expect(targetRun(iss, all, true)).toBe(iss)
    expect(targetRun(null, [state], true)).toBeNull()
    // A tool that takes any source keeps the selection, and falls back to the first run.
    expect(targetRun(state, all, false)).toBe(state)
    expect(targetRun(null, all, false)).toBe(state)
    expect(targetRun(null, [], false)).toBeNull()
  })
})
