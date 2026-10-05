import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from 'cesium'
import { watch } from 'vue'
import { usePlacesStore } from '../stores/places'
import { stationColorHex } from '../theme/stationColors'
import { useThemePreset } from '../theme/useThemePreset'
import { CHIP_ANCHOR_PX, PIN_SCALE, pinChip, pinImage } from './pinImage'

/** Camera distance past which a pin shrinks from its name tag to a bare icon badge. */
const CHIP_RANGE_M = 7_000_000
const NEAR = new DistanceDisplayCondition(0, CHIP_RANGE_M)
const FAR = new DistanceDisplayCondition(CHIP_RANGE_M, Number.MAX_VALUE)
/** The far badge only marks a spot, so it is smaller than the tag's icon disc. */
const BADGE_SCALE = PIN_SCALE * 0.75

/**
 * The user's place pins, plus the not-yet-saved point from a globe click.
 *
 * Up close each pin is a name tag whose stem ends in a dot on the spot; from afar it is a
 * small icon badge. Both are entities: `pin:<id>` (tag) and `pin-far:<id>` (badge).
 */
export function usePinLayer(viewer: Viewer) {
  const places = usePlacesStore()
  const theme = useThemePreset()
  let entities: Entity[] = []
  /** Marker images load asynchronously; a render that finishes after a newer one is dropped. */
  let generation = 0

  function clear() {
    entities.forEach((entity) => viewer.entities.remove(entity))
    entities = []
  }

  async function render() {
    const current = ++generation
    const globe = theme.preset.globe
    const pins = places.saved.pins.filter((pin) => pin.visible)
    const colorOf = (index: number) => stationColorHex(index, globe.pinPalette)
    const images = await Promise.all(
      pins.map((pin) =>
        Promise.all([
          pinChip(pin.icon, colorOf(pin.colorIndex), pin.name, {
            background: globe.chipBackground,
            text: globe.chipText,
            focused: places.focusedPinId === pin.id,
          }).catch(() => null),
          pinImage(pin.icon, colorOf(pin.colorIndex)).catch(() => null),
        ]),
      ),
    )
    if (current !== generation || viewer.isDestroyed()) return
    clear()
    pins.forEach((pin, i) => {
      const [chip, badge] = images[i]!
      const position = Cartesian3.fromDegrees(pin.lon_deg, pin.lat_deg)
      const focused = places.focusedPinId === pin.id
      entities.push(
        viewer.entities.add({
          id: `pin:${pin.id}`,
          name: pin.name,
          position,
          billboard: chip
            ? {
                image: chip,
                scale: focused ? PIN_SCALE * 1.1 : PIN_SCALE,
                verticalOrigin: VerticalOrigin.BOTTOM,
                // Anchor on the dot at the stem's tip, not the canvas edge.
                pixelOffset: new Cartesian2(0, CHIP_ANCHOR_PX),
                distanceDisplayCondition: NEAR,
              }
            : undefined,
          point: chip
            ? undefined
            : {
                pixelSize: 10,
                color: Color.fromCssColorString(colorOf(pin.colorIndex)),
                outlineColor: Color.WHITE,
                outlineWidth: 2,
              },
        }),
      )
      if (badge) {
        entities.push(
          viewer.entities.add({
            id: `pin-far:${pin.id}`,
            name: pin.name,
            position,
            billboard: {
              image: badge,
              scale: BADGE_SCALE,
              verticalOrigin: VerticalOrigin.CENTER,
              distanceDisplayCondition: FAR,
            },
          }),
        )
      }
    })
    const draft = places.draft
    if (draft) {
      entities.push(
        viewer.entities.add({
          id: 'pin-draft',
          position: Cartesian3.fromDegrees(draft.lon_deg, draft.lat_deg),
          point: {
            pixelSize: 12,
            color: Color.TRANSPARENT,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
          },
        }),
      )
    }
  }

  watch(
    () => [places.saved.pins, places.draft, places.focusedPinId, theme.preset.globe],
    () => void render(),
    { deep: true, immediate: true },
  )

  return {
    dispose() {
      generation++
      clear()
    },
  }
}
