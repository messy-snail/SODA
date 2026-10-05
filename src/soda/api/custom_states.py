"""State vectors the user typed in or imported as a CCSDS OPM."""

import asyncio
from datetime import datetime
from typing import Any

import numpy as np
from fastapi import APIRouter, Request, Response

from ..errors import CodedError
from ..gp.models import parse_epoch
from ..gp.sources import SPACECRAFT_KEYS, STATE_KEYS, CustomState, CustomStateNameTaken
from ..orbit.kepler import osculating_summary
from ..orbit.opm import MAX_OPM_BYTES, StateInput, build_state, parse_opm
from .errors import ApiError
from .schemas import CustomStateCreate, iso
from .uploads import read_limited_body

router = APIRouter()


def state_arrays(custom: CustomState) -> tuple[np.ndarray, np.ndarray]:
    """GCRS position (m) and velocity (m/s) of a stored state."""
    values = np.array([float(custom.state[key]) for key in STATE_KEYS])
    return values[:3], values[3:]


def state_epoch(custom: CustomState) -> datetime:
    return parse_epoch(custom.epoch)


def state_spacecraft(custom: CustomState) -> dict[str, float]:
    """The spacecraft parameters stored with a state; any of them may be missing."""
    return {key: float(custom.state[key]) for key in SPACECRAFT_KEYS if key in custom.state}


def state_summary(custom: CustomState) -> dict[str, Any]:
    """List entry for a state vector."""
    position, velocity = state_arrays(custom)
    return {
        "id": custom.id,
        "name": custom.name,
        "epoch": iso(state_epoch(custom)),
        "frame": custom.frame,
        "input_format": custom.input_format,
        "category": osculating_summary(position, velocity, custom.name)["category"],
        "created_at": custom.created_at,
    }


def state_detail(custom: CustomState) -> dict[str, Any]:
    """The ``/catalog/{norad_id}`` shape as far as it applies: no TLE, no OMM, no NORAD id."""
    position, velocity = state_arrays(custom)
    return {
        "norad_id": 0,
        "name": custom.name,
        "object_id": str(custom.state.get("object_id") or ""),
        "epoch": iso(state_epoch(custom)),
        "source": "user",
        "groups": [],
        "orbit": osculating_summary(position, velocity, custom.name),
        "tle": None,
        "omm": None,
        "state_id": custom.id,
        "frame": custom.frame,
        "state": custom.state,
        "input_format": custom.input_format,
        "created_at": custom.created_at,
    }


def load_state(request: Request, state_id: int) -> CustomState:
    """A stored state vector.

    Raises:
        ApiError: 404 ``stateNotFound`` when the id is unknown.
    """
    custom = request.app.state.gp.store.custom_state(state_id)
    if custom is None:
        raise ApiError(404, "stateNotFound", "상태벡터 없음", id=state_id)
    return custom


def save_state(request: Request, checked: StateInput, input_format: str) -> CustomState:
    """Store a checked state.

    Raises:
        ApiError: 409 ``stateNameTaken``.
    """
    try:
        return request.app.state.gp.store.add_custom_state(
            checked.name,
            checked.epoch.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            checked.frame,
            checked.stored(),
            input_format,
        )
    except CustomStateNameTaken as error:
        raise ApiError(409, "stateNameTaken", "같은 이름의 상태벡터가 이미 있음") from error


@router.get("/custom-states")
def list_custom_states(request: Request) -> list[dict]:
    return [state_summary(custom) for custom in request.app.state.gp.store.custom_states()]


@router.get("/custom-states/{state_id}")
def get_custom_state(request: Request, state_id: int) -> dict:
    return state_detail(load_state(request, state_id))


@router.post("/custom-states", status_code=201)
def create_custom_state(request: Request, body: CustomStateCreate) -> dict:
    try:
        checked = build_state(
            body.name,
            body.epoch,
            body.frame,
            np.array([body.x_m, body.y_m, body.z_m]),
            np.array([body.vx_m_s, body.vy_m_s, body.vz_m_s]),
            body.spacecraft(),
        )
    except CodedError as error:
        raise ApiError.of(422, error) from error
    return state_detail(save_state(request, checked, "form"))


@router.post("/custom-states/import", status_code=201)
async def import_custom_state(request: Request, name: str | None = None) -> dict:
    """Store the state vector of an uploaded OPM file (the raw request body)."""
    too_large = ApiError(413, "stateVectorInvalid", "상태벡터 오류 · OPM 파일이 너무 큼")
    body = await read_limited_body(request, MAX_OPM_BYTES, too_large)

    def run() -> dict:
        try:
            checked = parse_opm(body.decode("utf-8"), name)
        except UnicodeDecodeError as error:
            raise ApiError(
                422, "stateVectorInvalid", "상태벡터 오류 · UTF-8 텍스트 파일이 아님"
            ) from error
        except CodedError as error:
            raise ApiError.of(422, error) from error
        return state_detail(save_state(request, checked, "opm"))

    return await asyncio.to_thread(run)


@router.delete("/custom-states/{state_id}", status_code=204)
def delete_custom_state(request: Request, state_id: int) -> Response:
    if not request.app.state.gp.store.delete_custom_state(state_id):
        raise ApiError(404, "stateNotFound", "상태벡터 없음", id=state_id)
    return Response(status_code=204)
