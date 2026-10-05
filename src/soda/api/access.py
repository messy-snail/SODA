"""Imaging opportunity endpoint."""

import asyncio

from fastapi import APIRouter, Request

from ..orbit.access import AccessRequestError, access_report
from ..orbit.propagator import epoch_warnings
from .errors import ApiError
from .orbit import element_set_of, kernel_of, resolve
from .schemas import AccessRequest, flat, iso

router = APIRouter()


@router.post("/access")
async def access(request: Request, body: AccessRequest) -> dict:
    """Windows in which the satellite can point at each target, in the request's order.

    Each result also carries a ``diagnosis`` of the passes that did not become windows.
    """
    resolved = await resolve(request, body)
    kernel = await kernel_of(request)
    targets = [item.target() for item in body.targets]
    try:
        report = await asyncio.to_thread(
            access_report,
            resolved.elements.omm,
            targets,
            body.start,
            body.end,
            body.pointing(),
            kernel,
            body.shot_s,
        )
    except AccessRequestError as error:
        raise ApiError.of(422, error) from error
    results = []
    for target, windows, diagnosis in zip(targets, report.windows, report.diagnosis, strict=True):
        for window in windows:
            for key in ("start", "end", "best_time", "shot_start", "shot_end"):
                window[key] = iso(window[key])
            window["strip"] = {
                "left": flat(window.pop("strip_left"), 5),
                "right": flat(window.pop("strip_right"), 5),
            }
            window["track_fixed_m"] = flat(window["track_fixed_m"], 1)
        results.append({"target_id": target.id, "windows": windows, "diagnosis": diagnosis})
    return {
        "element_set": element_set_of(resolved, body),
        "results": results,
        "warnings": resolved.warnings
        + epoch_warnings(resolved.elements.epoch, body.start, body.end),
    }
