import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HorizontalOrigin,
  JulianDate,
  LabelStyle,
  PolylineDashMaterialProperty,
  PolylineOutlineMaterialProperty,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from 'cesium'
import { crispLabel } from './labelStyle'
import { interpolateTrack } from './passTrack'

/**
 * Graphics shared by the pass prediction and contact plan layers: a contact as a band
 * along its track, pins at AOS and LOS, and a dashed line of sight from the station.
 */

/**
 * The band sits on the same positions as the orbit trail, so it has to be wider than the
 * trail to show at all (in 2D the two project onto the same pixels).
 */
export const BAND_WIDTH_PX = 10
/** AOS/LOS labels would pile up on a whole-Earth view; they appear once zoomed in. */
const END_LABEL_RANGE_M = 12_000_000

export interface ContactTrack {
  aosMs: number
  losMs: number
  track: readonly number[]
}

export function trackPositions(track: readonly number[]): Cartesian3[] {
  const points: Cartesian3[] = []
  for (let i = 0; i + 2 < track.length; i += 3) {
    points.push(new Cartesian3(track[i], track[i + 1], track[i + 2]))
  }
  return points
}

/** A contact's track as a band; drawn through the orbit trail it shares positions with. */
export function addBand(
  viewer: Viewer,
  id: string,
  positions: Cartesian3[],
  color: Color,
  alpha = 0.55,
  width = BAND_WIDTH_PX,
): Entity {
  const material = new PolylineOutlineMaterialProperty({
    color: color.withAlpha(alpha),
    outlineColor: color.withAlpha(Math.min(1, alpha * 2)),
    outlineWidth: alpha >= 0.5 ? 2 : 1,
  })
  return viewer.entities.add({
    id,
    polyline: {
      positions,
      width,
      arcType: ArcType.NONE,
      material,
      depthFailMaterial: material,
    },
  })
}

/**
 * A dot with its label at one end of a contact. A hollow dot marks an end the search
 * could not reach, which is the edge of the search rather than a real AOS or LOS.
 */
export function addEndPin(
  viewer: Viewer,
  id: string,
  position: Cartesian3,
  color: Color,
  text: string,
  end: 'aos' | 'los',
  hollow = false,
): Entity {
  const aos = end === 'aos'
  return viewer.entities.add({
    id,
    position,
    point: {
      pixelSize: 8,
      color: hollow ? Color.TRANSPARENT : color,
      outlineColor: hollow ? color : Color.WHITE,
      outlineWidth: 2,
    },
    label: {
      text,
      ...crispLabel(11),
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK.withAlpha(0.75),
      // AOS reads left of its dot and LOS right, so the two ends of a short pass part.
      horizontalOrigin: aos ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(aos ? -8 : 8, 0),
      distanceDisplayCondition: new DistanceDisplayCondition(0, END_LABEL_RANGE_M),
    },
  })
}

/**
 * Line from a ground point to the satellite while one of ``contacts`` is on, dashed unless
 * told otherwise. Time comes from the Cesium clock, so scrubbing moves the line with the
 * satellite.
 */
export function addLineOfSight(
  viewer: Viewer,
  id: string,
  ground: Cartesian3,
  contacts: readonly ContactTrack[],
  color: Color,
  dashed = true,
): Entity {
  const scratch = new Cartesian3()
  const none: Cartesian3[] = []
  return viewer.entities.add({
    id,
    polyline: {
      positions: new CallbackProperty((time) => {
        if (!time) return none
        const ms = JulianDate.toDate(time).getTime()
        for (const contact of contacts) {
          const at = interpolateTrack(contact.track, contact.aosMs, contact.losMs, ms)
          if (at) return [ground, Cartesian3.fromElements(at[0], at[1], at[2], scratch)]
        }
        return none
      }, false),
      width: 2,
      arcType: ArcType.NONE,
      material: dashed ? new PolylineDashMaterialProperty({ color, dashLength: 12 }) : color,
    },
  })
}
