/**
 * Propagator choice and HPOP options, as the propagation form holds them and as the API
 * takes them. The limits mirror `src/soda/orbit/hpop/constants.py`.
 */

export type Propagator = 'sgp4' | 'hpop' | 'ephemeris'

export const HPOP_MAX_SPAN_DAYS = 7
export const HPOP_MAX_EPOCH_GAP_DAYS = 7
export const MAX_GRAVITY_DEGREE = 20
export const DEFAULT_GRAVITY_DEGREE = 8
/** Degrees offered in the form: J2 only, the default, and the whole bundled field. */
export const GRAVITY_DEGREES = [2, 8, 20] as const

const DAY_MS = 86_400_000

/** HPOP options as `/propagate` and `/swath` take them; absent spacecraft fields are estimated. */
export interface HpopOptions {
  gravity_degree: number
  third_body: boolean
  drag: boolean
  srp: boolean
  mass_kg?: number
  drag_area_m2?: number
  cd?: number
  srp_area_m2?: number
  cr?: number
}

/** The form's fields; spacecraft values are text so that blank means "estimate it". */
export interface HpopForm {
  gravityDegree: number
  thirdBody: boolean
  drag: boolean
  srp: boolean
  massKg: string
  areaM2: string
  cd: string
  cr: string
}

export function defaultHpopForm(): HpopForm {
  return {
    gravityDegree: DEFAULT_GRAVITY_DEGREE,
    thirdBody: true,
    drag: true,
    srp: true,
    massKg: '',
    areaM2: '',
    cd: '',
    cr: '',
  }
}

/** A positive number typed into a field, or undefined when it is blank or not one. */
function positive(text: string): number | undefined {
  if (!text.trim()) return undefined
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Whether every spacecraft field is blank or a positive number. */
export function hpopFormValid(form: HpopForm): boolean {
  return [form.massKg, form.areaM2, form.cd, form.cr].every(
    (text) => !text.trim() || positive(text) !== undefined,
  )
}

/** Request options for a form. One area serves both drag and radiation pressure. */
export function hpopRequest(form: HpopForm): HpopOptions {
  const area = positive(form.areaM2)
  const options: HpopOptions = {
    gravity_degree: Math.min(Math.max(Math.round(form.gravityDegree), 2), MAX_GRAVITY_DEGREE),
    third_body: form.thirdBody,
    drag: form.drag,
    srp: form.srp,
  }
  const mass = positive(form.massKg)
  const cd = positive(form.cd)
  const cr = positive(form.cr)
  if (mass !== undefined) options.mass_kg = mass
  if (area !== undefined) {
    options.drag_area_m2 = area
    options.srp_area_m2 = area
  }
  if (cd !== undefined) options.cd = cd
  if (cr !== undefined) options.cr = cr
  return options
}

/** Days from the epoch to the nearest edge of a window; zero when the epoch lies inside. */
export function epochGapDays(epochMs: number, startMs: number, endMs: number): number {
  return Math.max(startMs - epochMs, epochMs - endMs, 0) / DAY_MS
}

/**
 * Why HPOP would refuse a window, or null when it would take it: HPOP integrates from the
 * epoch, so both the window length and its distance from the epoch are bounded.
 */
export function hpopWindowProblem(
  epochMs: number,
  startMs: number,
  endMs: number,
): 'span' | 'epoch' | null {
  if (endMs - startMs > HPOP_MAX_SPAN_DAYS * DAY_MS) return 'span'
  if (epochGapDays(epochMs, startMs, endMs) > HPOP_MAX_EPOCH_GAP_DAYS) return 'epoch'
  return null
}

/**
 * The propagator a satellite will actually get. Only mean elements leave a choice: a state
 * vector is integrated and an ephemeris is interpolated, whatever the form says.
 */
export function effectivePropagator(
  kind: 'elements' | 'state' | 'ephemeris' | null,
  chosen: Propagator,
): Propagator {
  if (kind === 'state') return 'hpop'
  return kind === 'ephemeris' ? 'ephemeris' : chosen
}

/** Short name for a chip or an eyebrow; an interpolated ephemeris is known by its file type. */
export function propagatorLabel(propagator: Propagator): string {
  return propagator === 'ephemeris' ? 'OEM' : propagator.toUpperCase()
}

/** Whether a window `[startMs, endMs]` shares any time with a span. */
export function overlapsSpan(
  startMs: number,
  endMs: number,
  spanStartMs: number,
  spanEndMs: number,
): boolean {
  return startMs <= spanEndMs && endMs >= spanStartMs
}
