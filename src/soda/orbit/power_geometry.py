"""Where the solar array points, and how much of the Sun it sees.

The array is fixed to the body on the face opposite the camera, so its normal is the
reverse of the boresight: ``cos(incidence) = -boresight · sun``. Everything here is
Earth-fixed (ITRS), the frame the imaging roll and pitch are defined in.
"""

import numpy as np

from .access_geometry import surface_ecef
from .interpolate import DEFAULT_DEGREE, clamp_degree, lagrange
from .propagator import Ephemeris
from .swath import WGS84_A, WGS84_E2, geodetic_normals


def _unit(vectors: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norm > 0, norm, 1.0)


def states_at(ephemeris: Ephemeris, offsets_s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Earth-fixed position and velocity between the samples of an ephemeris.

    Args:
        ephemeris: Trajectory with at least two valid samples.
        offsets_s: ``(N,)`` seconds from the first sample, inside the trajectory.

    Returns:
        ``(N, 3)`` positions in metres and ``(N, 3)`` velocities in m/s.
    """
    rows = np.where(ephemeris.valid)[0]
    nodes = rows * ephemeris.step_s
    degree = clamp_degree(DEFAULT_DEGREE, len(rows))
    values = np.hstack((ephemeris.fixed_m[rows], ephemeris.fixed_velocity_m_s[rows]))
    query = np.clip(offsets_s, nodes[0], nodes[-1])
    state = lagrange(nodes, values, query, degree)
    return state[:, :3], state[:, 3:]


def geodetic_up(position_m: np.ndarray) -> np.ndarray:
    """Geodetic normals (WGS84) under Earth-fixed positions, shape ``(N, 3)``."""
    x, y, z = position_m[:, 0], position_m[:, 1], position_m[:, 2]
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1 - WGS84_E2))
    for _ in range(4):
        n = WGS84_A / np.sqrt(1 - WGS84_E2 * np.sin(lat) ** 2)
        lat = np.arctan2(z + WGS84_E2 * n * np.sin(lat), p)
    return geodetic_normals(np.degrees(lat), np.degrees(np.arctan2(y, x)))


def station_ecef(lat_deg: float, lon_deg: float, alt_m: float) -> np.ndarray:
    """Earth-fixed metres of a ground station, shape ``(3,)``."""
    point = np.array([[lat_deg, lon_deg]])
    return (surface_ecef(point) + alt_m * geodetic_normals(point[:, 0], point[:, 1]))[0]


def nadir_boresight(position_m: np.ndarray) -> np.ndarray:
    """Boresight of a satellite looking straight down (geodetic nadir)."""
    return -geodetic_up(position_m)


def shot_boresight(
    position_m: np.ndarray, velocity_m_s: np.ndarray, roll_deg: np.ndarray, pitch_deg: np.ndarray
) -> np.ndarray:
    """Boresight of a satellite tilted by an imaging roll and pitch.

    The inverse of ``access_geometry.geometry``: roll is measured across the ground track
    (positive right) and pitch along it (positive ahead), each from geodetic nadir.
    """
    up = geodetic_up(position_m)
    along = _unit(velocity_m_s - (velocity_m_s * up).sum(axis=1, keepdims=True) * up)
    right = np.cross(along, up)
    roll = np.tan(np.radians(roll_deg))[:, np.newaxis]
    pitch = np.tan(np.radians(pitch_deg))[:, np.newaxis]
    return _unit(-up + roll * right + pitch * along)


def station_boresight(position_m: np.ndarray, station_m: np.ndarray) -> np.ndarray:
    """Boresight of a satellite whose body follows a ground station."""
    return _unit(station_m - position_m)


def incidence_cos(boresight: np.ndarray, sun_unit: np.ndarray) -> np.ndarray:
    """Cosine of the Sun's incidence on the array, zero when the Sun is behind it."""
    return np.maximum(-(boresight * sun_unit).sum(axis=1), 0.0)
