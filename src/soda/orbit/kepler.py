"""Osculating orbit description of a state vector, for display.

A satellite known by a state or an ephemeris has no mean elements to summarise, so the
detail view shows the Kepler orbit that passes through one of its states instead.
"""

from math import pi, sqrt
from typing import Any

import numpy as np

from ..gp.classify import classify
from .hpop.constants import GM_EARTH, R_EARTH


def specific_energy(position_m: np.ndarray, velocity_m_s: np.ndarray) -> float:
    """Orbital energy per unit mass in J/kg; negative for a bound orbit."""
    speed_squared = float(velocity_m_s @ velocity_m_s)
    return 0.5 * speed_squared - GM_EARTH / float(np.linalg.norm(position_m))


def osculating_summary(
    position_m: np.ndarray, velocity_m_s: np.ndarray, name: str = ""
) -> dict[str, Any]:
    """The fields ``orbit_summary`` gives for mean elements, from one inertial state.

    Args:
        position_m: Inertial position.
        velocity_m_s: Inertial velocity.
        name: Object name, which the category rule looks at for debris markers.

    Returns:
        Category, period, inclination, eccentricity, semi-major axis, and apsis altitudes,
        with ``osculating`` set so the caller can tell them from mean elements.

    Raises:
        ValueError: The state is not on a bound orbit.
    """
    position = np.asarray(position_m, dtype=float)
    velocity = np.asarray(velocity_m_s, dtype=float)
    energy = specific_energy(position, velocity)
    if not energy < 0:
        raise ValueError("the state is not on a bound orbit")
    semi_major_m = -GM_EARTH / (2 * energy)
    momentum = np.cross(position, velocity)
    radius = float(np.linalg.norm(position))
    eccentricity_vector = np.cross(velocity, momentum) / GM_EARTH - position / radius
    eccentricity = float(np.linalg.norm(eccentricity_vector))
    period_s = 2 * pi * sqrt(semi_major_m**3 / GM_EARTH)
    inclination = np.degrees(np.arccos(np.clip(momentum[2] / np.linalg.norm(momentum), -1, 1)))
    elements = {
        "OBJECT_NAME": name,
        "MEAN_MOTION": 86400.0 / period_s,
        "ECCENTRICITY": eccentricity,
    }
    return {
        "category": classify(elements),
        "period_min": period_s / 60.0,
        "inclination_deg": float(inclination),
        "eccentricity": eccentricity,
        "semi_major_axis_km": semi_major_m / 1000.0,
        "apogee_alt_km": (semi_major_m * (1 + eccentricity) - R_EARTH) / 1000.0,
        "perigee_alt_km": (semi_major_m * (1 - eccentricity) - R_EARTH) / 1000.0,
        "osculating": True,
    }
