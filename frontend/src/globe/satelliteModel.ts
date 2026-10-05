import {
  CallbackProperty,
  Cartesian3,
  HeadingPitchRoll,
  JulianDate,
  Matrix3,
  Quaternion,
  ReferenceFrame,
  Transforms,
  type PositionProperty,
} from 'cesium'
import type { ModelSettings } from '../api/types'

const HALF_STEP_S = 0.5

/** Body-frame correction for a model whose axes do not follow the glTF forward/up convention. */
export function offsetQuaternion(
  settings: Pick<ModelSettings, 'heading_deg' | 'pitch_deg' | 'roll_deg'>,
): Quaternion {
  return Quaternion.fromHeadingPitchRoll(
    HeadingPitchRoll.fromDegrees(settings.heading_deg, settings.pitch_deg, settings.roll_deg),
  )
}

/**
 * Attitude that points the model's +X along the inertial velocity and +Z toward local up.
 *
 * Cesium's `VelocityOrientationProperty` differentiates Earth-fixed positions, which skews LEO
 * yaw by a few degrees. Differencing inertial positions and rotating into the fixed frame keeps
 * the model aligned with its orbit in both display frames.
 */
export function orbitalOrientation(position: PositionProperty, offset: Quaternion) {
  const before = new JulianDate()
  const after = new JulianDate()
  const previous = new Cartesian3()
  const next = new Cartesian3()
  const current = new Cartesian3()
  const velocity = new Cartesian3()
  const icrfToFixed = new Matrix3()
  const attitude = new Matrix3()

  return new CallbackProperty((time, result?: Quaternion) => {
    if (!time) return undefined
    const fixed = position.getValue(time, current)
    if (!fixed) return undefined
    JulianDate.addSeconds(time, -HALF_STEP_S, before)
    JulianDate.addSeconds(time, HALF_STEP_S, after)
    // Near the ends of the sampled window, fall back to a one-sided difference.
    const a =
      position.getValueInReferenceFrame(before, ReferenceFrame.INERTIAL, previous) ??
      position.getValueInReferenceFrame(time, ReferenceFrame.INERTIAL, previous)
    const b =
      position.getValueInReferenceFrame(after, ReferenceFrame.INERTIAL, next) ??
      position.getValueInReferenceFrame(time, ReferenceFrame.INERTIAL, next)
    if (!a || !b) return undefined
    Cartesian3.subtract(b, a, velocity)
    if (Cartesian3.magnitudeSquared(velocity) === 0) return undefined
    const rotation = Transforms.computeIcrfToFixedMatrix(time, icrfToFixed)
    if (!rotation) return undefined
    Matrix3.multiplyByVector(rotation, velocity, velocity)
    // The helper copies the velocity into the matrix as is, so it must be a unit vector.
    Cartesian3.normalize(velocity, velocity)
    Transforms.rotationMatrixFromPositionVelocity(fixed, velocity, undefined, attitude)
    const orientation = Quaternion.fromRotationMatrix(attitude, result ?? new Quaternion())
    return Quaternion.multiply(orientation, offset, orientation)
  }, false)
}
