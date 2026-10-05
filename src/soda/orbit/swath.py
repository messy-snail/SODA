"""Ground swath edges from look vectors intersected with the WGS84 ellipsoid.

For each sample the sensor looks along geodetic nadir rotated about the along-track axis by
``±angle``. The nadir swath uses half the field of view; the field of regard adds the maximum
off-nadir (roll) angle. Look vectors beyond the Earth's limb are clamped to the horizon.
"""

from dataclasses import dataclass

import numpy as np

from .propagator import Ephemeris

WGS84_A = 6_378_137.0
WGS84_F = 1 / 298.257223563
WGS84_B = WGS84_A * (1 - WGS84_F)
WGS84_E2 = WGS84_F * (2 - WGS84_F)
MEAN_RADIUS_M = 6_371_008.8
HORIZON_MARGIN_RAD = np.radians(0.2)


@dataclass(frozen=True)
class Sensor:
    """Cross-track sensor geometry.

    Attributes:
        fov_deg: Full cross-track field of view.
        max_off_nadir_deg: Maximum roll away from nadir for the field of regard.
        min_sun_elev_deg: Sun elevation at the subpoint required to count as daylight.
    """

    fov_deg: float
    max_off_nadir_deg: float = 0.0
    min_sun_elev_deg: float = 10.0


@dataclass(frozen=True)
class SwathSegment:
    kind: str
    daylight: bool
    i0: int
    i1: int
    left: np.ndarray
    right: np.ndarray


@dataclass(frozen=True)
class Swath:
    segments: list[SwathSegment]
    fov_deg: float
    nadir_width_km: float
    for_width_km: float | None
    daylight_fraction: float


def fov_from_swath_km(swath_km: float, altitude_km: float) -> float:
    """Full field of view that images ``swath_km`` at nadir from ``altitude_km`` (sphere)."""
    half_angle = swath_km * 1000.0 / 2.0 / MEAN_RADIUS_M
    ratio = (MEAN_RADIUS_M + altitude_km * 1000.0) / MEAN_RADIUS_M
    return float(2 * np.degrees(np.arctan2(np.sin(half_angle), ratio - np.cos(half_angle))))


def geodetic_normals(lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))


def _unit(vectors: np.ndarray) -> np.ndarray:
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def _ellipsoid_radius(lat_deg: np.ndarray) -> np.ndarray:
    lat = np.radians(lat_deg)
    a_cos, b_sin = WGS84_A * np.cos(lat), WGS84_B * np.sin(lat)
    return np.sqrt(((WGS84_A * a_cos) ** 2 + (WGS84_B * b_sin) ** 2) / (a_cos**2 + b_sin**2))


def intersect_ellipsoid(origin: np.ndarray, direction: np.ndarray) -> np.ndarray:
    """Nearest ray-ellipsoid hit; rays that miss return their closest approach."""
    scale = np.array([1 / WGS84_A, 1 / WGS84_A, 1 / WGS84_B])
    p, d = origin * scale, direction * scale
    qa = (d * d).sum(axis=1)
    qb = 2 * (p * d).sum(axis=1)
    qc = (p * p).sum(axis=1) - 1
    disc = np.maximum(qb * qb - 4 * qa * qc, 0.0)
    distance = (-qb - np.sqrt(disc)) / (2 * qa)
    return origin + distance[:, None] * direction


def surface_lonlat(points: np.ndarray) -> np.ndarray:
    """Longitude and geodetic latitude in degrees for points on the ellipsoid surface."""
    x, y, z = points.T
    lon = np.degrees(np.arctan2(y, x))
    lat = np.degrees(np.arctan2(z, (1 - WGS84_E2) * np.hypot(x, y)))
    return np.column_stack((lon, lat))


def edge_points(
    position_m: np.ndarray,
    velocity_m_s: np.ndarray,
    lat_deg: np.ndarray,
    lon_deg: np.ndarray,
    angle_deg: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Left and right ground points (ECEF metres) for a symmetric cross-track angle."""
    up = geodetic_normals(lat_deg, lon_deg)
    nadir = -up
    along = _unit(velocity_m_s - (velocity_m_s * nadir).sum(axis=1, keepdims=True) * nadir)
    right = _unit(np.cross(along, up))
    horizon = np.arcsin(
        np.clip(_ellipsoid_radius(lat_deg) / np.linalg.norm(position_m, axis=1), 0, 1)
    )
    angle = np.minimum(np.radians(angle_deg), horizon - HORIZON_MARGIN_RAD)[:, None]
    looks = [np.cos(angle) * nadir + sign * np.sin(angle) * right for sign in (-1.0, 1.0)]
    left, right_edge = (intersect_ellipsoid(position_m, look) for look in looks)
    return left, right_edge


def daylight_mask(
    lat_deg: np.ndarray, lon_deg: np.ndarray, sun_unit: np.ndarray, min_sun_elev_deg: float
) -> np.ndarray:
    """True where the Sun stands at least ``min_sun_elev_deg`` above the subpoint horizon."""
    up = geodetic_normals(lat_deg, lon_deg)
    return (up * sun_unit).sum(axis=1) >= np.sin(np.radians(min_sun_elev_deg))


def split_runs(valid: np.ndarray, daylight: np.ndarray) -> list[tuple[int, int, bool]]:
    """Inclusive index runs of constant daylight state, skipping invalid samples.

    Adjacent valid runs share their boundary sample so rendered strips have no gaps.
    """
    runs: list[tuple[int, int, bool]] = []
    start: int | None = None
    for index in range(len(valid)):
        if not valid[index]:
            if start is not None and index - 1 > start:
                runs.append((start, index - 1, bool(daylight[start])))
            start = None
            continue
        if start is None:
            start = index
        elif daylight[index] != daylight[start]:
            runs.append((start, index, bool(daylight[start])))
            start = index
    if start is not None and len(valid) - 1 > start:
        runs.append((start, len(valid) - 1, bool(daylight[start])))
    return runs


def _width_km(left: np.ndarray, right: np.ndarray, valid: np.ndarray) -> float:
    if not valid.any():
        return 0.0
    chord = np.linalg.norm(left[valid] - right[valid], axis=1)
    arc = 2 * MEAN_RADIUS_M * np.arcsin(np.clip(chord / (2 * MEAN_RADIUS_M), 0, 1))
    return float(arc.mean() / 1000.0)


def compute_swath(ephemeris: Ephemeris, sensor: Sensor, sun_unit: np.ndarray) -> Swath:
    """Nadir swath and field-of-regard strips split by daylight state.

    Args:
        ephemeris: Propagated samples.
        sensor: Sensor geometry.
        sun_unit: Earth-fixed unit vectors toward the Sun, one per sample.
    """
    e = ephemeris
    valid = e.valid
    daylight = daylight_mask(e.lat_deg, e.lon_deg, sun_unit, sensor.min_sun_elev_deg)
    runs = split_runs(valid, daylight)
    kinds = [("nadir", sensor.fov_deg / 2)]
    if sensor.max_off_nadir_deg > 0:
        kinds.append(("for", sensor.max_off_nadir_deg + sensor.fov_deg / 2))

    segments: list[SwathSegment] = []
    widths: dict[str, float] = {}
    safe_position = np.where(valid[:, None], e.fixed_m, [WGS84_A * 2, 0, 0])
    safe_velocity = np.where(valid[:, None], e.fixed_velocity_m_s, [0, 1, 0])
    for kind, angle in kinds:
        left, right = edge_points(safe_position, safe_velocity, e.lat_deg, e.lon_deg, angle)
        widths[kind] = _width_km(left, right, valid)
        left_ll, right_ll = surface_lonlat(left), surface_lonlat(right)
        segments.extend(
            SwathSegment(kind, day, i0, i1, left_ll[i0 : i1 + 1], right_ll[i0 : i1 + 1])
            for i0, i1, day in runs
        )
    return Swath(
        segments=segments,
        fov_deg=sensor.fov_deg,
        nadir_width_km=widths["nadir"],
        for_width_km=widths.get("for"),
        daylight_fraction=float(daylight[valid].mean()) if valid.any() else 0.0,
    )
