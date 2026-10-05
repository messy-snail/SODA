"""Searching public imagery catalogues and importing what was found.

A client names items by catalogue id. The download address is looked up by the server, inside
the import job, so a slow or failing catalogue shows up as a failed row and not as a request
that hangs.
"""

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ..imagery import warp
from ..imagery.catalog.service import CatalogService
from ..imagery.formats import ImageryError
from ..imagery.jobs import ImageryHub, Report
from ..imagery.limits import MAX_CATALOG_SEARCH_SPAN_DEG, MAX_IMAGERY_SETS
from .errors import ApiError
from .imagery import check_queue, job_summary
from .schemas import ImageryCatalogImport, iso

router = APIRouter()

Source = Literal["maxar", "oam"]


def _service(request: Request) -> CatalogService:
    return request.app.state.imagery_catalog


@router.get("/imagery/catalog/search")
async def search_catalog(
    request: Request,
    source: Source,
    west_deg: float = Query(ge=-180, le=180),
    south_deg: float = Query(ge=-90, le=90),
    east_deg: float = Query(ge=-180, le=180),
    north_deg: float = Query(ge=-90, le=90),
) -> dict:
    span = max(east_deg - west_deg, north_deg - south_deg)
    if east_deg <= west_deg or north_deg <= south_deg or span > MAX_CATALOG_SEARCH_SPAN_DEG:
        raise ApiError(
            422,
            "imageryCatalogAreaTooLarge",
            f"검색 범위는 {MAX_CATALOG_SEARCH_SPAN_DEG}° 이하여야 함 · 더 확대한 뒤 검색",
            max_deg=MAX_CATALOG_SEARCH_SPAN_DEG,
        )
    box = (west_deg, south_deg, east_deg, north_deg)
    try:
        return await asyncio.to_thread(_service(request).search, source, box)
    except ImageryError as error:
        raise ApiError.of(502, error) from error


def _origins(hub: ImageryHub) -> set[str]:
    """Origins of every set that exists or is on its way, to skip what is already here."""
    known = {item.origin for item in hub.library.entries() if item.origin}
    known.update(job.meta.get("origin") for job in hub.jobs() if job.status == "processing")
    return known


@router.post("/imagery/catalog/import")
def import_from_catalog(request: Request, body: ImageryCatalogImport) -> JSONResponse:
    hub: ImageryHub = request.app.state.imagery
    service = _service(request)
    try:
        for item_id in body.item_ids:
            service.check_id(body.source, item_id)
    except ImageryError as error:
        raise ApiError.of(422, error) from error
    known = _origins(hub)
    wanted = [item for item in dict.fromkeys(body.item_ids) if f"{body.source}:{item}" not in known]
    skipped = [
        {"item_id": item, "code": "alreadyImported"}
        for item in dict.fromkeys(body.item_ids)
        if item not in wanted
    ]
    if hub.library.count() + len(hub.jobs()) + len(wanted) > MAX_IMAGERY_SETS:
        raise ApiError(
            422,
            "imageryTooMany",
            f"영상은 최대 {MAX_IMAGERY_SETS}개까지 등록 가능",
            max=MAX_IMAGERY_SETS,
        )
    if wanted:
        check_queue(hub, len(wanted))
    queued = []
    for item_id in wanted:
        set_id = hub.library.new_id()
        meta: dict[str, Any] = {
            "name": service.provisional_name(body.source, item_id),
            "source_format": "geotiff",
            "attribution": "",
            "license": "",
            "origin": f"{body.source}:{item_id}",
            # Both catalogues hold photographs: satellite, aerial or drone.
            "sensor": "optical",
            "acquired_at": None,
            "created_at": iso(datetime.now(UTC)),
        }
        queued.append(job_summary(hub.submit(set_id, meta, _work(service, body.source, item_id))))
    return JSONResponse({"queued": queued, "skipped": skipped}, status_code=202)


def _work(service: CatalogService, source: str, item_id: str):
    """The job for one item: look it up, download it, cut it."""

    def work(target: Path, report: Report) -> dict[str, Any]:
        downloaded = target.with_name("source")
        resolved = service.fetch(source, item_id, downloaded, report)

        def tiling(fraction: float, stage: str = "tiling") -> None:
            report(0.5 + 0.5 * fraction, stage)

        facts = warp.import_geotiff(downloaded, target, tiling)
        if resolved.gsd_m is not None:
            # What the catalogue says the sensor resolved, not the grid it was resampled to.
            facts["gsd_m"] = resolved.gsd_m
        return {
            **facts,
            "name": resolved.name,
            "attribution": resolved.attribution,
            "license": resolved.license,
            "acquired_at": resolved.acquired_at,
        }

    return work
