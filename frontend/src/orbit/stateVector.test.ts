import { describe, expect, it } from 'vitest'
import { emptyStateForm, stateRequest, type StateForm } from './stateVector'

function filled(changes: Partial<StateForm> = {}): StateForm {
  return {
    ...emptyStateForm('2026-09-16T00:00:30'),
    name: ' my sat ',
    position: ['7078.1363', '0', '0'],
    velocity: ['0', '4.5', '6.0'],
    ...changes,
  }
}

describe('stateRequest', () => {
  it('converts km and km/s to metres and names the frame', () => {
    expect(stateRequest(filled({ frame: 'ITRF' }))).toEqual({
      name: 'my sat',
      epoch: '2026-09-16T00:00:30.000Z',
      frame: 'ITRF',
      x_m: 7078136.3,
      y_m: 0,
      z_m: 0,
      vx_m_s: 0,
      vy_m_s: 4500,
      vz_m_s: 6000,
    })
  })

  it('sends spacecraft values only when given, one area for drag and SRP', () => {
    const request = stateRequest(filled({ massKg: '120', areaM2: '0.9', cd: '2.3', cr: '1.4' }))
    expect(request).toMatchObject({
      mass_kg: 120,
      drag_area_m2: 0.9,
      srp_area_m2: 0.9,
      cd: 2.3,
      cr: 1.4,
    })
    expect(stateRequest(filled())).not.toHaveProperty('mass_kg')
  })

  it('is null until every required field is usable', () => {
    expect(stateRequest(emptyStateForm('2026-09-16T00:00'))).toBeNull()
    expect(stateRequest(filled({ name: '  ' }))).toBeNull()
    expect(stateRequest(filled({ epoch: 'soon' }))).toBeNull()
    expect(stateRequest(filled({ position: ['7000', '', '0'] }))).toBeNull()
    expect(stateRequest(filled({ velocity: ['0', 'abc', '0'] }))).toBeNull()
    expect(stateRequest(filled({ massKg: '-1' }))).toBeNull()
  })
})
