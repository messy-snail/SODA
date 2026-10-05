"""Geometry for imaging opportunities: satellite frames, pointing angles, and limits.

Roll tilts the sensor across the ground track (positive to the right, the swath's ``r``
direction) and pitch tilts it along the track (positive ahead). Both are measured from
geodetic nadir in the plane they share with it, so a target needs ``|roll| <= limit`` and
``|pitch| <= limit`` independently, the way agility is usually specified.
"""

from dataclasses import dataclass, fields
from datetime import datetime
from typing import Any, Literal

import numpy as np
from skyfield.api import wgs84
from skyfield.framelib import itrs
from skyfield.jpllib import SpiceKernel

from .propagator import times_at
from .sun import sun_unit_itrs
from .swath import (
    HORIZON_MARGIN_RAD,
    MEAN_RADIUS_M,
    WGS84_A,
    WGS84_E2,
    geodetic_normals,
    intersect_ellipsoid,
    surface_lonlat,
)

PointingMode = Literal["roll", "roll_pitch"]


@dataclass(frozen=True)
class Pointing:
    """How far the sensor can point, and how much light the target needs.

    Attributes:
        mode: ``roll`` images only as the cross-track plane sweeps over a target;
            ``roll_pitch`` can also look ahead and behind within ``max_pitch_deg``.
        max_roll_deg: Largest roll of the sensor boresight.
        max_pitch_deg: Largest pitch; only used by ``roll_pitch``.
        fov_deg: Full cross-track field of view. Half of it widens the roll reach, since a
            target at the image edge is still imaged.
        min_sun_elev_deg: Sun elevation required at the target.
    """

    mode: PointingMode
    max_roll_deg: float
    max_pitch_deg: float
    fov_deg: float
    min_sun_elev_deg: float

    @property
    def roll_reach_deg(self) -> float:
        return self.max_roll_deg + self.fov_deg / 2

    def lit(self, sin_sun: np.ndarray) -> np.ndarray:
        return sin_sun >= np.sin(np.radians(self.min_sun_elev_deg))

    def aimable(self, valid: np.ndarray, geo: "Geometry") -> np.ndarray:
        """Inside both angle limits, in view, and lit (``roll_pitch``)."""
        return (
            valid
            & geo.front
            & (np.abs(geo.roll_deg) <= self.roll_reach_deg)
            & (np.abs(geo.pitch_deg) <= self.max_pitch_deg)
            & (geo.sin_elev > 0)
            & self.lit(geo.sin_sun)
        )

    def on_plane(self, valid: np.ndarray, geo: "Geometry") -> np.ndarray:
        """Within roll reach, in view, and lit, ignoring pitch (``roll`` at a crossing)."""
        return (
            valid
            & geo.front
            & (np.abs(geo.roll_deg) <= self.roll_reach_deg)
            & (geo.sin_elev > 0)
            & self.lit(geo.sin_sun)
        )


@dataclass(frozen=True)
class State:
    """Satellite samples with the local frame the pointing angles are measured in."""

    position_m: np.ndarray
    velocity_m_s: np.ndarray
    lat_deg: np.ndarray
    lon_deg: np.ndarray
    up: np.ndarray
    along: np.ndarray
    right: np.ndarray
    sun: np.ndarray
    valid: np.ndarray

    def take(self, rows: np.ndarray) -> "State":
        return State(*(getattr(self, field.name)[rows] for field in fields(self)))

    def __len__(self) -> int:
        return len(self.valid)


@dataclass(frozen=True)
class Geometry:
    """Per-row look from the satellite to a ground point."""

    roll_deg: np.ndarray
    pitch_deg: np.ndarray
    off_nadir_deg: np.ndarray
    #: The point is on the nadir side of the satellite (not behind its horizon plane).
    front: np.ndarray
    sin_elev: np.ndarray
    sin_sun: np.ndarray


def wrap_lon(lon_deg: Any) -> Any:
    return (np.asarray(lon_deg) + 180.0) % 360.0 - 180.0


def surface_ecef(points_deg: np.ndarray) -> np.ndarray:
    """Earth-fixed metres for ``(lat, lon)`` rows on the WGS84 ellipsoid."""
    lat, lon = np.radians(points_deg[:, 0]), np.radians(points_deg[:, 1])
    n = WGS84_A / np.sqrt(1 - WGS84_E2 * np.sin(lat) ** 2)
    return np.column_stack(
        (
            n * np.cos(lat) * np.cos(lon),
            n * np.cos(lat) * np.sin(lon),
            n * (1 - WGS84_E2) * np.sin(lat),
        )
    )


def _unit(vectors: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norm > 0, norm, 1.0)


def state_at(satellite: Any, kernel: SpiceKernel, start: datetime, offsets: np.ndarray) -> State:
    """Satellite state at ``start + offsets`` seconds."""
    t = times_at(start, np.atleast_1d(offsets))
    geocentric = satellite.at(t)
    fixed, velocity = geocentric.frame_xyz_and_velocity(itrs)
    geodetic = wgs84.geographic_position_of(geocentric)
    position = np.atleast_2d(fixed.m.T)
    valid = np.isfinite(position).all(axis=1)
    lat = np.where(valid, np.atleast_1d(geodetic.latitude.degrees), 0.0)
    lon = np.where(valid, np.atleast_1d(geodetic.longitude.degrees), 0.0)
    v = np.where(valid[:, None], np.atleast_2d(velocity.m_per_s.T), [0.0, 1.0, 0.0])
    up = geodetic_normals(lat, lon)
    along = _unit(v - (v * up).sum(axis=1, keepdims=True) * up)
    return State(
        position_m=np.where(valid[:, None], position, [WGS84_A * 2, 0, 0]),
        velocity_m_s=v,
        lat_deg=lat,
        lon_deg=lon,
        up=up,
        along=along,
        right=np.cross(along, up),
        sun=sun_unit_itrs(kernel, t),
        valid=valid,
    )


def geometry(state: State, points_deg: np.ndarray) -> Geometry:
    """Roll, pitch and visibility of ``points_deg[i]`` from ``state`` row ``i``."""
    points_m = surface_ecef(points_deg)
    points_up = geodetic_normals(points_deg[:, 0], points_deg[:, 1])
    look = points_m - state.position_m
    distance = np.linalg.norm(look, axis=1)
    down = -(look * state.up).sum(axis=1)
    across = (look * state.right).sum(axis=1)
    ahead = (look * state.along).sum(axis=1)
    return Geometry(
        roll_deg=np.degrees(np.arctan2(across, down)),
        pitch_deg=np.degrees(np.arctan2(ahead, down)),
        off_nadir_deg=np.degrees(np.arccos(np.clip(down / distance, -1, 1))),
        front=down > 0,
        sin_elev=-(look * points_up).sum(axis=1) / distance,
        sin_sun=(points_up * state.sun).sum(axis=1),
    )


def cross_track_arc(state: State, reach_deg: float, count: int) -> np.ndarray:
    """Ground points the cross-track plane reaches, ``(N, count, 2)`` as ``(lat, lon)``.

    Look angles run evenly over ``±reach_deg`` and are clamped to the horizon the same way
    the swath edges are.
    """
    radius = np.linalg.norm(state.position_m, axis=1)
    horizon = np.arcsin(np.clip(WGS84_A * (1 - WGS84_E2 / 2) / radius, 0, 1))
    limit = np.minimum(np.radians(reach_deg), horizon - HORIZON_MARGIN_RAD)
    fractions = np.linspace(-1.0, 1.0, count)
    points = np.empty((len(state), count, 2))
    for k, fraction in enumerate(fractions):
        angle = (fraction * limit)[:, None]
        look = np.cos(angle) * -state.up + np.sin(angle) * state.right
        hit = intersect_ellipsoid(state.position_m, look)
        lonlat = surface_lonlat(hit)
        points[:, k, 0], points[:, k, 1] = lonlat[:, 1], lonlat[:, 0]
    return points


def in_box(points_deg: np.ndarray, box_deg: tuple[float, float, float, float]) -> np.ndarray:
    """Which ``(..., 2)`` ``(lat, lon)`` points lie in a box; ``east < west`` wraps."""
    west, south, east, north = box_deg
    lat, lon = points_deg[..., 0], points_deg[..., 1]
    width = (east - west) % 360.0
    return (lat >= south) & (lat <= north) & ((lon - west) % 360.0 <= width)


def central_angle_deg(lat_deg: np.ndarray, lon_deg: np.ndarray, lat0: float, lon0: float):
    """Great-circle angle from ``(lat0, lon0)``, spherical."""
    a, b = np.radians(lat_deg), np.radians(lat0)
    dlon = np.radians(lon_deg - lon0)
    cos = np.sin(a) * np.sin(b) + np.cos(a) * np.cos(b) * np.cos(dlon)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def within_reach(
    state: State, lat0: float, lon0: float, radius_deg: float, off_nadir_deg: float
) -> np.ndarray:
    """Cheap prefilter: samples from which a look can land within a circle on the ground.

    Args:
        state: Satellite samples.
        lat0: Latitude of the circle's centre.
        lon0: Longitude of the circle's centre.
        radius_deg: Great-circle radius of the circle.
        off_nadir_deg: Largest angle off nadir the sensor can look.

    Returns:
        Per sample, whether the subpoint is close enough, with a degree to spare.
    """
    ratio = np.linalg.norm(state.position_m, axis=1) / MEAN_RADIUS_M
    alpha = np.radians(min(off_nadir_deg, 89.0))
    reach = np.degrees(np.arcsin(np.clip(ratio * np.sin(alpha), 0, 1)) - alpha)
    distance = central_angle_deg(state.lat_deg, state.lon_deg, lat0, lon0)
    return state.valid & (distance <= radius_deg + reach + 1.0)
