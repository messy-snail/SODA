import { defineStore } from 'pinia'
import { markRaw, reactive, ref, shallowRef, watch } from 'vue'
import { translate } from '../i18n'
import { useLocaleStore } from '../i18n/useLocale'
import {
  CITY_HEIGHT_M,
  DEFAULT_HOME,
  sanitizePoint,
  type Bbox,
  type CameraPoint,
} from '../places/camera'
import { loadCities, loadCountries, loadShapes } from '../places/geoData'
import { defaultPinName, type NamingData } from '../places/naming'
import type { PinIcon } from '../places/pinIcons'
import { cleanName, loadPlaces, MAX_PINS, savePlaces, type Pin } from './placesPersistence'

/** A camera move the view-control layer carries out; `seq` makes a repeat request fire. */
export type FlyRequest =
  { kind: 'point'; point: CameraPoint; seq: number } | { kind: 'rect'; bbox: Bbox; seq: number }

/** What a new pin starts as; an empty name and a null colour mean "pick one for me". */
export interface PinDraft {
  name: string
  icon: PinIcon
  colorIndex: number | null
}

/** A candidate pin location shown as a ring until the user adds it or moves on. */
export interface PinCandidate {
  lon_deg: number
  lat_deg: number
  /** Name and icon a search result suggests for the pin form. */
  name?: string
  icon?: PinIcon
  seq: number
}

/** Ask the view-control layer for the camera position, for the home view or a new pin. */
export type CaptureRequest =
  { purpose: 'home'; seq: number } | { purpose: 'pin'; draft: PinDraft; seq: number }

/** Local storage for places, or null in browser tests, which must start from a clean state. */
function placesStorage(): Storage | null {
  try {
    return new URLSearchParams(location.search).has('e2e') ? null : localStorage
  } catch {
    return null
  }
}

let sequence = 0
const newId = () => `pin-${Date.now().toString(36)}-${(sequence++).toString(36)}`

export const usePlacesStore = defineStore('places', () => {
  const locale = useLocaleStore()
  const storage = placesStorage()
  const saved = reactive(loadPlaces(storage))
  let nextColor = saved.pins.reduce((max, pin) => Math.max(max, pin.colorIndex + 1), 0)

  const flyRequest = ref<FlyRequest | null>(null)
  const captureRequest = ref<CaptureRequest | null>(null)
  /** While on, a globe click fills `draft` instead of picking. */
  const placing = ref(false)
  /** Candidate location from a globe click, typed coordinates or a search result. */
  const draft = ref<PinCandidate | null>(null)
  /** Pin last clicked on the globe, so the card can highlight it. */
  const focusedPinId = ref<string | null>(null)
  /** Cities, countries and shapes for default names; loaded on first need. */
  const naming = shallowRef<NamingData | null>(null)
  let requests = 0

  async function loadNaming(): Promise<void> {
    if (naming.value) return
    try {
      const [cities, countries, shapes] = await Promise.all([
        loadCities(),
        loadCountries(),
        loadShapes(),
      ])
      naming.value = markRaw({ cities, countries, shapes })
    } catch {
      /* Pins fall back to numbered names. */
    }
  }

  /** The name a pin at this point gets when the user gives none. */
  function suggestName(lon_deg: number, lat_deg: number): string {
    return defaultPinName(
      lon_deg,
      lat_deg,
      naming.value,
      locale.locale,
      saved.pins.map((pin) => pin.name),
      translate('places.pins.defaultName', { n: saved.pins.length + 1 }),
    )
  }

  function flyToPoint(point: CameraPoint) {
    const clean = sanitizePoint(point)
    if (clean) flyRequest.value = { kind: 'point', point: clean, seq: ++requests }
  }

  function flyToBbox(bbox: Bbox) {
    flyRequest.value = { kind: 'rect', bbox, seq: ++requests }
  }

  function setHome(point: CameraPoint) {
    const clean = sanitizePoint(point)
    if (clean) saved.home = clean
  }

  function resetHome() {
    saved.home = { ...DEFAULT_HOME }
  }

  function requestHomeCapture() {
    captureRequest.value = { purpose: 'home', seq: ++requests }
  }

  function requestPinCapture(pinDraft: PinDraft) {
    captureRequest.value = { purpose: 'pin', draft: { ...pinDraft }, seq: ++requests }
  }

  /** Called by the view-control layer with the camera position a capture asked for. */
  function receiveCapture(request: CaptureRequest, point: CameraPoint) {
    if (request.purpose === 'home') setHome(point)
    else addPin({ ...request.draft, ...point })
  }

  /** Add a pin; an empty name becomes the suggested one. Returns its id, or null. */
  function addPin(
    input: PinDraft & { lon_deg: number; lat_deg: number; height_m?: number },
  ): string | null {
    const point = sanitizePoint({ height_m: CITY_HEIGHT_M, ...input })
    if (!point || Math.abs(input.lat_deg) > 90 || saved.pins.length >= MAX_PINS) return null
    const name = cleanName(input.name) ?? suggestName(point.lon_deg, point.lat_deg)
    const id = newId()
    const auto = input.colorIndex === null
    saved.pins.push({
      id,
      name,
      ...point,
      icon: input.icon,
      colorIndex: auto ? nextColor++ : input.colorIndex!,
      visible: true,
    })
    return id
  }

  function updatePin(id: string, changes: Partial<Pick<Pin, 'name' | 'icon' | 'colorIndex'>>) {
    const pin = saved.pins.find((p) => p.id === id)
    if (!pin) return
    if (changes.name !== undefined) pin.name = cleanName(changes.name) ?? pin.name
    if (changes.icon) pin.icon = changes.icon
    if (changes.colorIndex !== undefined) pin.colorIndex = changes.colorIndex
  }

  function togglePin(id: string) {
    const pin = saved.pins.find((p) => p.id === id)
    if (pin) pin.visible = !pin.visible
  }

  function removePin(id: string) {
    saved.pins = saved.pins.filter((pin) => pin.id !== id)
    if (focusedPinId.value === id) focusedPinId.value = null
  }

  function setPlacing(on: boolean) {
    placing.value = on
    if (on) void loadNaming()
  }

  /** Show a candidate pin location; the pin form picks up its coordinates and suggestion. */
  function setDraft(
    lon_deg: number,
    lat_deg: number,
    suggestion: { name?: string; icon?: PinIcon } = {},
  ) {
    draft.value = { lon_deg, lat_deg, ...suggestion, seq: ++requests }
    void loadNaming()
  }

  function clearDraft() {
    draft.value = null
  }

  function receiveClick(lon_deg: number, lat_deg: number) {
    setDraft(lon_deg, lat_deg)
  }

  function focusPin(id: string | null) {
    focusedPinId.value = id
  }

  watch(saved, () => savePlaces(storage, saved), { deep: true })

  return {
    saved,
    flyRequest,
    captureRequest,
    placing,
    draft,
    focusedPinId,
    naming,
    loadNaming,
    suggestName,
    flyToPoint,
    flyToBbox,
    setHome,
    resetHome,
    requestHomeCapture,
    requestPinCapture,
    receiveCapture,
    addPin,
    updatePin,
    togglePin,
    removePin,
    setPlacing,
    setDraft,
    clearDraft,
    receiveClick,
    focusPin,
  }
})
