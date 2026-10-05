"""Coverage endpoint: imaging events of every cell of a grid over a box."""

import asyncio

from fastapi import APIRouter, Request

from ..orbit.coverage import CoverageRequestError, coverage_events
from ..orbit.propagator import as_utc, epoch_warnings
from .errors import ApiError
from .orbit import element_set_of, kernel_of, resolve
from .schemas import CoverageRequest, iso

router = APIRouter()


@router.post("/coverage")
async def coverage(request: Request, body: CoverageRequest) -> dict:
    """When one satellite can image each cell centre, as seconds from ``start``.

    ``counts[k]`` events belong to cell ``k`` (column ``k % nx`` from the west, row
    ``k // nx`` from the south) and ``offset_s`` lists them cell after cell. The caller
    merges satellites and derives counts and revisit gaps.
    """
    resolved = await resolve(request, body)
    kernel = await kernel_of(request)
    try:
        events = await asyncio.to_thread(
            coverage_events,
            resolved.elements.omm,
            body.box(),
            body.nx,
            body.ny,
            body.start,
            body.end,
            body.pointing(),
            kernel,
        )
    except CoverageRequestError as error:
        raise ApiError.of(422, error) from error
    return {
        "element_set": element_set_of(resolved, body),
        "start": iso(as_utc(body.start)),
        "end": iso(as_utc(body.end)),
        "grid": {
            "west_deg": body.west_deg,
            "south_deg": body.south_deg,
            "east_deg": body.east_deg,
            "north_deg": body.north_deg,
            "nx": body.nx,
            "ny": body.ny,
        },
        "counts": events.counts.tolist(),
        "offset_s": events.offset_s.tolist(),
        "warnings": resolved.warnings
        + epoch_warnings(resolved.elements.epoch, body.start, body.end),
    }
