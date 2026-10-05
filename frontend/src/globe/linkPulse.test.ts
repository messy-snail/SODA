import { describe, expect, it } from 'vitest'
import { PULSE_MS, pulsePosition } from './linkPulse'

const ground = [0, 0, 0] as const
const satellite = [100, 200, 400] as const

describe('pulsePosition', () => {
  it('carries an uplink from the ground to the satellite', () => {
    expect(pulsePosition(ground, satellite, 'up', 0)).toEqual([0, 0, 0])
    expect(pulsePosition(ground, satellite, 'up', PULSE_MS / 2)).toEqual([50, 100, 200])
    expect(pulsePosition(ground, satellite, 'up', PULSE_MS)).toEqual([100, 200, 400])
  })

  it('carries a downlink the other way', () => {
    expect(pulsePosition(ground, satellite, 'down', 0)).toEqual([100, 200, 400])
    expect(pulsePosition(ground, satellite, 'down', PULSE_MS / 4)).toEqual([75, 150, 300])
  })

  it('shows nothing before it leaves or after it arrives', () => {
    expect(pulsePosition(ground, satellite, 'up', -1)).toBeNull()
    expect(pulsePosition(ground, satellite, 'up', PULSE_MS + 1)).toBeNull()
    expect(pulsePosition(ground, satellite, 'up', Number.NEGATIVE_INFINITY)).toBeNull()
    expect(pulsePosition(ground, satellite, 'up', 10, 0)).toBeNull()
  })
})
