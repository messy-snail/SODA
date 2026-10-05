"""State vectors the user supplies: typed in, or read from a CCSDS OPM file.

Both paths end in ``build_state``, which converts the state to GCRS and checks that it is
something the numerical propagator can start from.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

from ..errors import CodedError
from ..gp import ndm
from ..gp.sources import SPACECRAFT_KEYS, STATE_KEYS
from .frames import to_gcrs
from .hpop.constants import R_EARTH, REENTRY_ALT_M
from .kepler import specific_energy
from .propagator import as_utc, timescale

MAX_OPM_BYTES = 1024 * 1024
MAX_NAME_LENGTH = 60

#: OPM keywords for the spacecraft, and the state field each one fills.
OPM_SPACECRAFT = {
    "MASS": "mass_kg",
    "DRAG_AREA": "drag_area_m2",
    "DRAG_COEFF": "cd",
    "SOLAR_RAD_AREA": "srp_area_m2",
    "SOLAR_RAD_COEFF": "cr",
}
OPM_POSITION = ("X", "Y", "Z")
OPM_VELOCITY = ("X_DOT", "Y_DOT", "Z_DOT")


@dataclass(frozen=True)
class StateInput:
    """A checked state in GCRS, ready to be stored."""

    name: str
    epoch: datetime
    #: Frame the state was given in.
    frame: str
    position_m: np.ndarray
    velocity_m_s: np.ndarray
    spacecraft: dict[str, float] = field(default_factory=dict)
    object_id: str = ""

    def stored(self) -> dict[str, Any]:
        """The ``state`` JSON of a ``CustomState``."""
        values = [*self.position_m.tolist(), *self.velocity_m_s.tolist()]
        return {
            **dict(zip(STATE_KEYS, values, strict=True)),
            **self.spacecraft,
            "object_id": self.object_id,
        }


def _invalid(text: str) -> CodedError:
    return CodedError("stateVectorInvalid", f"상태벡터 오류 · {text}", reason=text)


def check_state(position_m: np.ndarray, velocity_m_s: np.ndarray) -> None:
    """Reject a GCRS state the propagator cannot start from.

    Raises:
        CodedError: ``stateVectorInvalid`` for a non-finite state, one at or below the
            re-entry height, or one that is not on a bound orbit.
    """
    if not (np.isfinite(position_m).all() and np.isfinite(velocity_m_s).all()):
        raise _invalid("값이 숫자가 아님")
    if np.linalg.norm(position_m) <= R_EARTH + REENTRY_ALT_M:
        raise _invalid("위치가 고도 100 km 이하")
    if not specific_energy(position_m, velocity_m_s) < 0:
        raise _invalid("지구에 묶인 궤도가 아님")


def build_state(
    name: str,
    epoch: datetime,
    frame: str,
    position_m: np.ndarray,
    velocity_m_s: np.ndarray,
    spacecraft: dict[str, Any] | None = None,
    object_id: str = "",
) -> StateInput:
    """Convert a state to GCRS and check it.

    Args:
        name: Name to store it under.
        epoch: State epoch (naive values are UTC).
        frame: ``REF_FRAME`` of the state: an inertial frame, ``ITRF``, or ``TEME``.
        position_m: Position in the given frame.
        velocity_m_s: Velocity in the given frame.
        spacecraft: Any of ``mass_kg``, ``drag_area_m2``, ``cd``, ``srp_area_m2``, ``cr``.
        object_id: International designator, if known.

    Raises:
        CodedError: ``stateVectorInvalid``.
    """
    name = name.strip()[:MAX_NAME_LENGTH]
    if not name:
        raise _invalid("이름 없음")
    epoch = as_utc(epoch)
    position = np.asarray(position_m, dtype=float)
    velocity = np.asarray(velocity_m_s, dtype=float)
    if position.shape != (3,) or velocity.shape != (3,):
        raise _invalid("위치·속도는 각각 3성분")
    if not (np.isfinite(position).all() and np.isfinite(velocity).all()):
        raise _invalid("값이 숫자가 아님")
    try:
        position, velocity = to_gcrs(frame, timescale().from_datetime(epoch), position, velocity)
    except ValueError as error:
        raise _invalid(f"지원하지 않는 좌표계 {frame}") from error
    check_state(position, velocity)
    craft: dict[str, float] = {}
    for key in SPACECRAFT_KEYS:
        value = (spacecraft or {}).get(key)
        if value is None:
            continue
        if not (np.isfinite(value) and value > 0):
            raise _invalid(f"{key}는 양수여야 함")
        craft[key] = float(value)
    return StateInput(name, epoch, frame.strip().upper(), position, velocity, craft, object_id)


def _opm_fields(text: str) -> dict[str, str]:
    stripped = text.removeprefix("﻿").lstrip()
    if stripped.startswith("<"):
        root = ndm.parse_xml(stripped)
        message = root if root.tag == "opm" else root.find(".//opm")
        if message is None:
            raise ValueError("no OPM in the document")
        return ndm.leaf_values(message)
    messages = ndm.split_kvn_messages(ndm.kvn_pairs(stripped), "CCSDS_OPM_VERS")
    if len(messages) != 1:
        raise ValueError("expected exactly one OPM")
    return messages[0]


def parse_opm(text: str, name: str | None = None) -> StateInput:
    """Read the state vector of a CCSDS OPM, KVN or XML.

    Keplerian elements, covariance and manoeuvres in the message are ignored. The centre
    must be the Earth and the time system UTC.

    Args:
        text: Decoded file contents.
        name: Name to store it under; defaults to the message's ``OBJECT_NAME``.

    Raises:
        CodedError: ``stateVectorInvalid``.
    """
    try:
        fields = _opm_fields(text)
        if fields.get("CENTER_NAME", "EARTH").strip().upper() != "EARTH":
            raise ValueError("CENTER_NAME must be EARTH")
        if fields.get("TIME_SYSTEM", "UTC").strip().upper() != "UTC":
            raise ValueError("TIME_SYSTEM must be UTC")
        epoch = ndm.parse_epoch(fields["EPOCH"])
        # OPM states are in km and km/s.
        position = np.array([float(fields[key]) for key in OPM_POSITION]) * 1000.0
        velocity = np.array([float(fields[key]) for key in OPM_VELOCITY]) * 1000.0
        spacecraft = {
            target: float(fields[key]) for key, target in OPM_SPACECRAFT.items() if key in fields
        }
        frame = fields["REF_FRAME"]
    except (KeyError, ValueError) as error:
        raise _invalid("OPM 형식 오류") from error
    return build_state(
        name or fields.get("OBJECT_NAME", ""),
        epoch,
        frame,
        position,
        velocity,
        spacecraft,
        fields.get("OBJECT_ID", "").strip(),
    )


def stored_state(name: str, epoch: datetime, frame: str, state: dict[str, Any]) -> StateInput:
    """Check a state that is already in GCRS, as a backup file carries it.

    ``frame`` is only the label of what the state was originally given in.

    Raises:
        CodedError: ``stateVectorInvalid``.
    """
    try:
        values = np.array([float(state[key]) for key in STATE_KEYS])
    except (KeyError, TypeError, ValueError) as error:
        raise _invalid("상태 값 누락") from error
    checked = build_state(
        name, epoch, "GCRF", values[:3], values[3:], state, str(state.get("object_id") or "")
    )
    return StateInput(
        checked.name,
        checked.epoch,
        frame.strip().upper(),
        checked.position_m,
        checked.velocity_m_s,
        checked.spacecraft,
        checked.object_id,
    )
