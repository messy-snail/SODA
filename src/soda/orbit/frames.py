"""Reference frames a state vector or an ephemeris may arrive in, converted to GCRS.

SODA keeps inertial states in GCRS, the frame Skyfield computes in. CCSDS messages name
their frame with ``REF_FRAME``; the ones accepted here are the Earth-centred frames a
satellite operator would normally use.
"""

from typing import Literal

import numpy as np
from skyfield.framelib import itrs
from skyfield.sgp4lib import TEME
from skyfield.timelib import Time

from .hpop.constants import OMEGA_EARTH

FrameFamily = Literal["gcrs", "itrf", "teme"]

#: Treated as GCRS. EME2000 differs from GCRS by a fixed frame bias of about 23 mas,
#: under a metre at LEO, which is not corrected.
INERTIAL_FRAMES = frozenset({"GCRF", "GCRS", "ICRF", "EME2000", "J2000"})


def frame_family(name: str) -> FrameFamily | None:
    """Which conversion a ``REF_FRAME`` value needs, or ``None`` when it is not supported."""
    frame = name.strip().upper().replace("-", "").replace("_", "")
    if frame in INERTIAL_FRAMES:
        return "gcrs"
    if frame.startswith("ITRF") or frame == "ITRS":
        return "itrf"
    if frame == "TEME":
        return "teme"
    return None


def to_gcrs(
    frame: str, t: Time, position_m: np.ndarray, velocity_m_s: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Convert states to GCRS.

    Args:
        frame: ``REF_FRAME`` value of the states.
        t: Time of each state; a single time for a single state.
        position_m: ``(N, 3)`` or ``(3,)`` positions in metres.
        velocity_m_s: Velocities in m/s, the same shape.

    Returns:
        Positions and velocities in GCRS, in the shape they came in.

    Raises:
        ValueError: The frame is not one of the supported ones.
    """
    family = frame_family(frame)
    if family is None:
        raise ValueError(f"unsupported reference frame {frame!r}")
    position = np.asarray(position_m, dtype=float)
    velocity = np.asarray(velocity_m_s, dtype=float)
    if family == "gcrs":
        return position.copy(), velocity.copy()
    single = position.ndim == 1
    r, v = np.atleast_2d(position), np.atleast_2d(velocity)
    if family == "itrf":
        # An Earth-fixed velocity leaves out the frame's own rotation; put it back.
        v = v + np.cross([0.0, 0.0, OMEGA_EARTH], r)
        rotation = itrs.rotation_at(t)
    else:
        rotation = TEME.rotation_at(t)
    # ``rotation`` takes GCRS to the frame; its transpose brings the states back.
    if rotation.ndim == 2:
        rotation = rotation[:, :, np.newaxis]
    r_gcrs = np.einsum("jin,nj->ni", rotation, r)
    v_gcrs = np.einsum("jin,nj->ni", rotation, v)
    return (r_gcrs[0], v_gcrs[0]) if single else (r_gcrs, v_gcrs)
