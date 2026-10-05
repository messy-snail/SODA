"""Vectorized SGP4 propagation into Earth-fixed, inertial, and geodetic coordinates."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache
from typing import Any

import numpy as np
from sgp4 import exporter
from skyfield.api import EarthSatellite, Timescale, load, wgs84
from skyfield.constants import AU_M, DAY_S
from skyfield.framelib import itrs
from skyfield.positionlib import Geocentric
from skyfield.timelib import Time

from ..errors import CodedError, message
from ..gp.classify import classify

MAX_SPAN = timedelta(days=30)
MAX_SAMPLES = 100_000
MIN_STEP_S = 1.0
STALE_AFTER = timedelta(days=7)
ALPHA5_MAX = 339_999


class PropagationRequestError(CodedError, ValueError):
    """The requested window or step is outside the supported limits."""


@cache
def timescale() -> Timescale:
    return load.timescale(builtin=True)


def satellite_from_omm(omm: dict[str, Any]) -> EarthSatellite:
    """Build a Skyfield satellite. Catalog numbers beyond Alpha-5 are not needed by SGP4."""
    fields = dict(omm)
    if int(fields["NORAD_CAT_ID"]) > ALPHA5_MAX:
        fields["NORAD_CAT_ID"] = 0
    return EarthSatellite.from_omm(timescale(), fields)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def epoch_warnings(epoch: datetime, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """Warn when any part of a window lies more than ``STALE_AFTER`` from the element epoch.

    Args:
        epoch: Element set epoch (naive values are UTC).
        start: Window start.
        end: Window end.

    Returns:
        An ``elementsFarFromEpoch`` warning, or nothing when the window stays close.
    """
    epoch, start, end = as_utc(epoch), as_utc(start), as_utc(end)
    distance = max(abs(start - epoch), abs(end - epoch))
    if distance <= STALE_AFTER:
        return []
    return [
        message(
            "elementsFarFromEpoch",
            f"궤도요소 epoch에서 최대 {distance.days}일 떨어진 구간 · "
            "궤도 오차가 수 km 이상일 수 있음",
            days=distance.days,
        )
    ]


def sample_offsets(start: datetime, end: datetime, step_s: float) -> np.ndarray:
    """Seconds after ``start`` for a regular grid that includes ``start``.

    Raises:
        PropagationRequestError: Window, step, or sample count out of range.
    """
    span = end - start
    if span <= timedelta(0):
        raise PropagationRequestError("endBeforeStart", "종료 시각은 시작 시각보다 늦어야 함")
    if span > MAX_SPAN:
        raise PropagationRequestError(
            "spanTooLong", f"전파 기간은 최대 {MAX_SPAN.days}일", days=MAX_SPAN.days
        )
    if step_s < MIN_STEP_S:
        raise PropagationRequestError(
            "stepTooSmall", f"스텝은 {MIN_STEP_S:g}초 이상이어야 함", min_s=MIN_STEP_S
        )
    count = int(span.total_seconds() // step_s) + 1
    if count > MAX_SAMPLES:
        raise PropagationRequestError(
            "tooManySamples",
            f"샘플 수 {count:,}개가 최대 {MAX_SAMPLES:,}개 초과 · 스텝을 늘려야 함",
            count=count,
            max=MAX_SAMPLES,
        )
    return np.arange(count, dtype=float) * step_s


def times_at(start: datetime, offsets: np.ndarray) -> Time:
    start = as_utc(start)
    seconds = start.second + start.microsecond / 1e6 + offsets
    return timescale().utc(start.year, start.month, start.day, start.hour, start.minute, seconds)


@dataclass(frozen=True)
class Ephemeris:
    start: datetime
    step_s: float
    times: Time
    fixed_m: np.ndarray
    fixed_velocity_m_s: np.ndarray
    inertial_m: np.ndarray
    lat_deg: np.ndarray
    lon_deg: np.ndarray
    alt_km: np.ndarray
    valid: np.ndarray
    warnings: list[dict[str, Any]]
    #: GCRS velocity, for callers that hand the trajectory on as a state (OEM export).
    inertial_velocity_m_s: np.ndarray | None = None

    def __len__(self) -> int:
        return len(self.lat_deg)


def ephemeris_from_gcrs(
    start: datetime,
    step_s: float,
    t: Time,
    position_m: np.ndarray,
    velocity_m_s: np.ndarray,
    valid: np.ndarray,
    warnings: list[dict[str, Any]],
) -> Ephemeris:
    """Build an ``Ephemeris`` from GCRS states, whatever propagator produced them.

    The Earth-fixed and geodetic coordinates come from the same Skyfield calls the SGP4 path
    uses, so every propagator ends up in the same frames.

    Args:
        start: Window start, UTC.
        step_s: Sample spacing in seconds.
        t: Sample times.
        position_m: ``(N, 3)`` GCRS positions; rows of an invalid sample may be non-finite.
        velocity_m_s: ``(N, 3)`` GCRS velocities.
        valid: ``(N,)`` mask of the samples the propagator could compute.
        warnings: Messages to carry on the result.
    """
    geocentric = Geocentric(
        position_m.T / AU_M, velocity_m_s.T / AU_M * DAY_S, t=t, center=399, target=None
    )
    fixed, velocity = geocentric.frame_xyz_and_velocity(itrs)
    geodetic = wgs84.geographic_position_of(geocentric)
    fixed_m = fixed.m.T
    return Ephemeris(
        start=start,
        step_s=step_s,
        times=t,
        fixed_m=fixed_m,
        fixed_velocity_m_s=velocity.m_per_s.T,
        inertial_m=position_m,
        lat_deg=np.atleast_1d(geodetic.latitude.degrees),
        lon_deg=np.atleast_1d(geodetic.longitude.degrees),
        alt_km=np.atleast_1d(geodetic.elevation.km),
        valid=valid & np.isfinite(fixed_m).all(axis=1),
        warnings=warnings,
        inertial_velocity_m_s=velocity_m_s,
    )


def propagate(omm: dict[str, Any], start: datetime, end: datetime, step_s: float) -> Ephemeris:
    """Propagate one element set over a regular time grid.

    Args:
        omm: Normalized OMM fields.
        start: Window start (naive values are UTC).
        end: Window end.
        step_s: Sample spacing in seconds.

    Returns:
        Samples in ITRS (Earth-fixed), GCRS (inertial), and WGS84 geodetic coordinates.
    """
    start, end = as_utc(start), as_utc(end)
    offsets = sample_offsets(start, end, step_s)
    t = times_at(start, offsets)
    satellite = satellite_from_omm(omm)
    geocentric = satellite.at(t)
    fixed, velocity = geocentric.frame_xyz_and_velocity(itrs)
    fixed_m = fixed.m.T
    valid = np.isfinite(fixed_m).all(axis=1)
    geodetic = wgs84.geographic_position_of(geocentric)

    warnings = epoch_warnings(satellite.epoch.utc_datetime(), start, end)
    if not valid.all():
        failed = int((~valid).sum())
        warnings.append(
            message(
                "sgp4Failures",
                f"SGP4가 {failed}개 샘플 계산 실패 (재진입·감쇠 가능)",
                count=failed,
            )
        )

    return Ephemeris(
        start=start,
        step_s=step_s,
        times=t,
        fixed_m=fixed_m,
        fixed_velocity_m_s=velocity.m_per_s.T,
        inertial_m=geocentric.position.m.T,
        lat_deg=np.atleast_1d(geodetic.latitude.degrees),
        lon_deg=np.atleast_1d(geodetic.longitude.degrees),
        alt_km=np.atleast_1d(geodetic.elevation.km),
        valid=valid,
        warnings=warnings,
        inertial_velocity_m_s=geocentric.velocity.m_per_s.T,
    )


def orbit_summary(omm: dict[str, Any]) -> dict[str, Any]:
    """Mean-element orbit description for display."""
    model = satellite_from_omm(omm).model
    radius_km = model.radiusearthkm
    return {
        "category": classify(omm),
        "period_min": 2 * np.pi / model.no_kozai,
        "inclination_deg": float(omm["INCLINATION"]),
        "eccentricity": float(omm["ECCENTRICITY"]),
        "semi_major_axis_km": model.a * radius_km,
        "apogee_alt_km": model.alta * radius_km,
        "perigee_alt_km": model.altp * radius_km,
    }


def tle_lines(omm: dict[str, Any]) -> tuple[str, str] | None:
    """TLE rendering for display; Alpha-5 above 99999, unavailable above 339999."""
    if int(omm["NORAD_CAT_ID"]) > ALPHA5_MAX:
        return None
    return exporter.export_tle(satellite_from_omm(omm).model)
