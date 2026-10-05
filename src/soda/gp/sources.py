"""Records of the orbit sources a user brings in that are not mean elements.

OMM stays the one standard for orbital elements. A state vector (CCSDS OPM) and an
ephemeris (CCSDS OEM) are different kinds of thing and are stored as such, each in its own
table and under its own id.
"""

from dataclasses import dataclass
from typing import Any

#: Keys of ``CustomState.state`` that carry the GCRS state, in metres and m/s.
STATE_KEYS = ("x_m", "y_m", "z_m", "vx_m_s", "vy_m_s", "vz_m_s")
#: Optional keys describing the spacecraft, which HPOP uses for drag and radiation pressure.
SPACECRAFT_KEYS = ("mass_kg", "drag_area_m2", "cd", "srp_area_m2", "cr")


@dataclass(frozen=True)
class CustomState:
    """A state vector the user typed in or imported as an OPM."""

    id: int
    name: str
    #: UTC ISO 8601 with a ``Z`` suffix and microseconds.
    epoch: str
    #: Frame the state was given in. ``state`` itself is always GCRS.
    frame: str
    #: ``STATE_KEYS``, any of ``SPACECRAFT_KEYS``, and ``object_id``.
    state: dict[str, Any]
    #: ``"form"`` (typed in) or ``"opm"`` (imported file).
    input_format: str
    #: UTC ISO 8601 with a ``Z`` suffix.
    created_at: str


class CustomStateNameTaken(Exception):
    """Raised by ``add_custom_state`` when another entry has the name."""


@dataclass(frozen=True)
class CustomEphemeris:
    """An ephemeris the user imported as an OEM: a table of GCRS states."""

    id: int
    name: str
    #: ``object_id``, ``frame`` (as in the file), ``degree`` and ``segments`` (row ranges).
    meta: dict[str, Any]
    #: Times of the first and last sample, UTC ISO 8601 with a ``Z`` suffix.
    start: str
    stop: str
    sample_count: int
    #: UTC ISO 8601 with a ``Z`` suffix.
    created_at: str
    #: Little-endian float64 rows of ``[seconds after start, x, y, z (m), vx, vy, vz (m/s)]``.
    #: ``None`` in a listing, which leaves the samples in the database.
    samples: bytes | None = None


class CustomEphemerisNameTaken(Exception):
    """Raised by ``add_custom_ephemeris`` when another entry has the name."""
