import type { CustomStateInput } from '../api/types'
import { fromUtcInput } from '../utils/time'

/** Frames a state vector can be typed in; the server converts every one to GCRS. */
export const STATE_FRAMES = ['GCRF', 'EME2000', 'ITRF', 'TEME'] as const
export type StateFrame = (typeof STATE_FRAMES)[number]

/** The form's fields. Position and velocity are in km and km/s, as an OPM gives them. */
export interface StateForm {
  name: string
  /** `datetime-local` value, UTC. */
  epoch: string
  frame: StateFrame
  position: [string, string, string]
  velocity: [string, string, string]
  massKg: string
  areaM2: string
  cd: string
  cr: string
}

export function emptyStateForm(epoch: string): StateForm {
  return {
    name: '',
    epoch,
    frame: 'GCRF',
    position: ['', '', ''],
    velocity: ['', '', ''],
    massKg: '',
    areaM2: '',
    cd: '',
    cr: '',
  }
}

function number(text: string): number | null {
  if (!text.trim()) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * The request for a filled-in form, or null while something required is missing or a number
 * does not parse. Blank spacecraft fields are left out so HPOP estimates them; one area serves
 * both drag and radiation pressure.
 */
export function stateRequest(form: StateForm): CustomStateInput | null {
  const position = form.position.map(number)
  const velocity = form.velocity.map(number)
  const epochMs = fromUtcInput(form.epoch)
  if (!form.name.trim() || Number.isNaN(epochMs)) return null
  if ([...position, ...velocity].some((value) => value === null)) return null
  const optional = { massKg: form.massKg, areaM2: form.areaM2, cd: form.cd, cr: form.cr }
  const craft: Partial<Record<keyof typeof optional, number>> = {}
  for (const [key, text] of Object.entries(optional) as [keyof typeof optional, string][]) {
    if (!text.trim()) continue
    const value = number(text)
    if (value === null || value <= 0) return null
    craft[key] = value
  }
  const [x, y, z] = position as number[]
  const [vx, vy, vz] = velocity as number[]
  return {
    name: form.name.trim(),
    epoch: new Date(epochMs).toISOString(),
    frame: form.frame,
    x_m: x! * 1000,
    y_m: y! * 1000,
    z_m: z! * 1000,
    vx_m_s: vx! * 1000,
    vy_m_s: vy! * 1000,
    vz_m_s: vz! * 1000,
    ...(craft.massKg !== undefined ? { mass_kg: craft.massKg } : {}),
    ...(craft.areaM2 !== undefined
      ? { drag_area_m2: craft.areaM2, srp_area_m2: craft.areaM2 }
      : {}),
    ...(craft.cd !== undefined ? { cd: craft.cd } : {}),
    ...(craft.cr !== undefined ? { cr: craft.cr } : {}),
  }
}
