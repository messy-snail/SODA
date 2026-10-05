"""Sun direction from the JPL DE421 ephemeris, downloaded on first use."""

from functools import cache
from pathlib import Path

import numpy as np
from skyfield.api import Loader
from skyfield.framelib import itrs
from skyfield.jpllib import SpiceKernel
from skyfield.timelib import Time

from .propagator import Ephemeris

EPHEMERIS_FILE = "de421.bsp"
#: Points of a beta angle series; the angle moves by degrees per day, so this is plenty.
MAX_BETA_POINTS = 240


@cache
def planets(directory: Path) -> SpiceKernel:
    directory.mkdir(parents=True, exist_ok=True)
    return Loader(str(directory), verbose=False)(EPHEMERIS_FILE)


def sun_unit_itrs(kernel: SpiceKernel, t: Time) -> np.ndarray:
    """Earth-fixed unit vectors from the geocenter toward the Sun, shape ``(N, 3)``."""
    vector = (kernel["sun"] - kernel["earth"]).at(t).frame_xyz(itrs).m
    vector = np.atleast_2d(vector.T)
    return vector / np.linalg.norm(vector, axis=1, keepdims=True)


def sun_unit_gcrs(kernel: SpiceKernel, t: Time) -> np.ndarray:
    """Inertial (GCRS) unit vectors from the geocenter toward the Sun, shape ``(N, 3)``."""
    vector = np.atleast_2d((kernel["sun"] - kernel["earth"]).at(t).position.m.T)
    return vector / np.linalg.norm(vector, axis=1, keepdims=True)


def sun_distance_au(kernel: SpiceKernel, t: Time) -> np.ndarray:
    """Distance from the geocenter to the Sun in astronomical units, shape ``(N,)``."""
    return np.atleast_1d((kernel["sun"] - kernel["earth"]).at(t).distance().au)


def beta_series_deg(
    ephemeris: Ephemeris, kernel: SpiceKernel, max_points: int = MAX_BETA_POINTS
) -> tuple[np.ndarray, np.ndarray] | None:
    """Sun angle off the orbit plane over an ephemeris, thinned to ``max_points``.

    The orbit normal is the cross product of two consecutive positions, so only samples whose
    successor is also valid are used. The first and last such samples are always included.

    Returns:
        Seconds from the start and degrees, positive on the side of the orbit's angular
        momentum, or ``None`` when no two consecutive samples are valid.
    """
    pairs = np.where(ephemeris.valid[:-1] & ephemeris.valid[1:])[0]
    if pairs.size == 0:
        return None
    picks = np.linspace(0, pairs.size - 1, min(max_points, pairs.size)).round().astype(int)
    rows = pairs[np.unique(picks)]
    normal = np.cross(ephemeris.inertial_m[rows], ephemeris.inertial_m[rows + 1])
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    sun = sun_unit_gcrs(kernel, ephemeris.times[rows])
    beta = np.degrees(np.arcsin(np.clip((normal * sun).sum(axis=1), -1, 1)))
    return rows * ephemeris.step_s, beta
