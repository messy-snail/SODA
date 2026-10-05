"""Ephemerides the user imported as CCSDS OEM files."""

import asyncio
from typing import Any

import numpy as np
from fastapi import APIRouter, Request, Response

from ..errors import CodedError
from ..gp.models import parse_epoch
from ..gp.sources import CustomEphemeris, CustomEphemerisNameTaken
from ..orbit.kepler import osculating_summary
from ..orbit.oem import MAX_OEM_BYTES, StoredEphemeris, parse_oem
from .errors import ApiError
from .schemas import iso
from .uploads import read_limited_body

router = APIRouter()

_STAMP = "%Y-%m-%dT%H:%M:%S.%fZ"


def stored_ephemeris(custom: CustomEphemeris) -> StoredEphemeris:
    """The samples of a stored ephemeris, ready to be interpolated."""
    assert custom.samples is not None, "listings carry no samples"
    samples = np.frombuffer(custom.samples, dtype="<f8").reshape(-1, 7)
    return StoredEphemeris(
        name=custom.name,
        object_id=str(custom.meta.get("object_id") or ""),
        frame=str(custom.meta.get("frame") or ""),
        start=parse_epoch(custom.start),
        samples=samples,
        segments=tuple((int(first), int(end)) for first, end in custom.meta["segments"]),
        degree=int(custom.meta["degree"]),
    )


def ephemeris_orbit(stored: StoredEphemeris) -> dict[str, Any]:
    """Osculating orbit through the first sample, which ``parse_oem`` checked is bound."""
    return osculating_summary(stored.samples[0, 1:4], stored.samples[0, 4:7], stored.name)


def ephemeris_summary(custom: CustomEphemeris) -> dict[str, Any]:
    """List entry for an imported ephemeris."""
    return {
        "id": custom.id,
        "name": custom.name,
        "start": iso(parse_epoch(custom.start)),
        "stop": iso(parse_epoch(custom.stop)),
        "sample_count": custom.sample_count,
        "frame": str(custom.meta.get("frame") or ""),
        "created_at": custom.created_at,
    }


def ephemeris_detail(custom: CustomEphemeris) -> dict[str, Any]:
    """The ``/catalog/{norad_id}`` shape as far as it applies, plus the span of the table."""
    stored = stored_ephemeris(custom)
    return {
        "norad_id": 0,
        "name": custom.name,
        "object_id": stored.object_id,
        # The first sample stands in for an epoch: it is where the table starts.
        "epoch": iso(stored.start),
        "source": "user",
        "groups": [],
        "orbit": ephemeris_orbit(stored),
        "tle": None,
        "omm": None,
        "ephemeris_id": custom.id,
        "frame": stored.frame,
        "span_start": iso(stored.start),
        "span_end": iso(stored.stop),
        "sample_count": custom.sample_count,
        "created_at": custom.created_at,
    }


def load_ephemeris(request: Request, ephemeris_id: int) -> CustomEphemeris:
    """A stored ephemeris with its samples.

    Raises:
        ApiError: 404 ``ephemerisNotFound`` when the id is unknown.
    """
    custom = request.app.state.gp.store.custom_ephemeris(ephemeris_id)
    if custom is None:
        raise ApiError(404, "ephemerisNotFound", "ephemeris 없음", id=ephemeris_id)
    return custom


@router.get("/custom-ephemerides")
def list_custom_ephemerides(request: Request) -> list[dict]:
    store = request.app.state.gp.store
    return [ephemeris_summary(custom) for custom in store.custom_ephemerides()]


@router.get("/custom-ephemerides/{ephemeris_id}")
def get_custom_ephemeris(request: Request, ephemeris_id: int) -> dict:
    return ephemeris_detail(load_ephemeris(request, ephemeris_id))


@router.post("/custom-ephemerides", status_code=201)
async def import_custom_ephemeris(request: Request, name: str | None = None) -> dict:
    """Store an uploaded OEM file (the raw request body)."""
    megabytes = MAX_OEM_BYTES // (1024 * 1024)
    too_large = ApiError(
        413, "oemTooLarge", f"OEM 파일은 {megabytes} MB 이하만 가져오기 가능", max_mb=megabytes
    )
    body = await read_limited_body(request, MAX_OEM_BYTES, too_large)
    store = request.app.state.gp.store

    def run() -> dict:
        try:
            parsed = parse_oem(body.decode("utf-8"), name)
        except UnicodeDecodeError as error:
            raise ApiError(422, "oemInvalid", "OEM 형식 오류 · UTF-8 텍스트 파일이 아님") from error
        except CodedError as error:
            raise ApiError.of(422, error) from error
        try:
            custom = store.add_custom_ephemeris(
                parsed.name,
                parsed.meta(),
                parsed.start.strftime(_STAMP),
                parsed.stop.strftime(_STAMP),
                np.ascontiguousarray(parsed.samples, dtype="<f8").tobytes(),
                len(parsed.samples),
            )
        except CustomEphemerisNameTaken as error:
            raise ApiError(
                409, "ephemerisNameTaken", "같은 이름의 ephemeris가 이미 있음"
            ) from error
        return ephemeris_detail(custom)

    return await asyncio.to_thread(run)


@router.delete("/custom-ephemerides/{ephemeris_id}", status_code=204)
def delete_custom_ephemeris(request: Request, ephemeris_id: int) -> Response:
    if not request.app.state.gp.store.delete_custom_ephemeris(ephemeris_id):
        raise ApiError(404, "ephemerisNotFound", "ephemeris 없음", id=ephemeris_id)
    return Response(status_code=204)
