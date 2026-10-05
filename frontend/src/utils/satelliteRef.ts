/** What a user-supplied satellite is known by; each kind has its own table and ids. */
export type CustomKind = 'elements' | 'state' | 'ephemeris'

/**
 * Which satellite a request or run is about: a catalog object by NORAD number, or something
 * the user saved. Saved elements carry whatever NORAD number was pasted (it may clash with a
 * catalog object); a saved state vector or ephemeris has none, so its `noradId` is 0.
 */
export interface SatelliteRef {
  noradId: number
  /** Id of the saved entry, in the table `kind` names; null for a catalog object. */
  customId: number | null
  /** Absent means saved elements, which is all there was before state vectors. */
  kind?: CustomKind
}

const KEY_PREFIX: Record<CustomKind, string> = {
  elements: 'custom',
  state: 'state',
  ephemeris: 'oem',
}
const KIND_OF_PREFIX: Record<string, CustomKind> = {
  custom: 'elements',
  state: 'state',
  oem: 'ephemeris',
}

export function customKind(ref: SatelliteRef): CustomKind | null {
  return ref.customId == null ? null : (ref.kind ?? 'elements')
}

/**
 * Whether the satellite has mean elements (TLE/OMM). Passes, imaging opportunities and the
 * TC/TM link need them; a state vector can only be integrated and an ephemeris only read.
 */
export function hasElements(ref: SatelliteRef): boolean {
  const kind = customKind(ref)
  return kind === null || kind === 'elements'
}

/**
 * The run a single-satellite tool works on: the selected one when the tool can use it,
 * otherwise the first it can. Tools that compute with SGP4 pass `elementsOnly`.
 */
export function targetRun<T extends SatelliteRef>(
  selected: T | null,
  all: readonly T[],
  elementsOnly: boolean,
): T | null {
  const usable = (run: T) => !elementsOnly || hasElements(run)
  if (selected && usable(selected)) return selected
  return all.find(usable) ?? null
}

/** One string per satellite, for maps, storage keys and "same satellite" checks. */
export function satKey(ref: SatelliteRef): string {
  const kind = customKind(ref)
  return kind ? `${KEY_PREFIX[kind]}:${ref.customId}` : `norad:${ref.noradId}`
}

export function sameSatellite(a: SatelliteRef, b: SatelliteRef): boolean {
  return satKey(a) === satKey(b)
}

/** The API's way of naming the satellite: exactly one of the ids. */
export function refParams(
  ref: SatelliteRef,
): { norad_id: number } | { custom_id: number } | { state_id: number } | { ephemeris_id: number } {
  const kind = customKind(ref)
  if (kind === 'state') return { state_id: ref.customId! }
  if (kind === 'ephemeris') return { ephemeris_id: ref.customId! }
  if (kind === 'elements') return { custom_id: ref.customId! }
  return { norad_id: ref.noradId }
}

/** Reads a ref back from `satKey`, or null for anything else. */
export function parseSatKey(key: string): SatelliteRef | null {
  const match = /^(norad|custom|state|oem):(\d{1,9})$/.exec(key)
  if (!match) return null
  const id = Number(match[2])
  const kind = KIND_OF_PREFIX[match[1]!]
  if (!kind) return { noradId: id, customId: null }
  // Saved elements keep the shape they always had, so stored refs compare equal.
  return kind === 'elements' ? { noradId: 0, customId: id } : { noradId: 0, customId: id, kind }
}
