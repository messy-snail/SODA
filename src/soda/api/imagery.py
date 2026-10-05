"""User imagery: upload, list, edit, delete, and the tiles the globe draws.

An upload is the raw file in the request body with its description in the query string, so
the three accepted formats need neither multipart parsing nor a server-side path.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from ..imagery import mbtiles, warp
from ..imagery.formats import ImageryError
from ..imagery.jobs import ImageryHub, ImportJob
from ..imagery.library import ImagerySet
from ..imagery.limits import (
    MAX_ATTRIBUTION_LENGTH,
    MAX_IMAGERY_BYTES,
    MAX_IMAGERY_SETS,
    MAX_IMPORT_QUEUE,
    MAX_LICENSE_LENGTH,
    MAX_NAME_LENGTH,
)
from ..imagery.tiling import parse_corners
from ..orbit.propagator import as_utc
from .errors import ApiError
from .schemas import ImageryUpdate, iso
from .uploads import stream_limited_body

router = APIRouter()

NOT_FOUND = ApiError(404, "imageryNotFound", "영상 없음")
BUSY = ApiError(409, "imageryBusy", "영상 파일 사용 중 · 잠시 후 다시 시도 필요")
SAMPLE_LOCKED = ApiError(422, "imagerySampleLocked", "샘플 영상은 수정·삭제 불가")

# Ids are never reused, so the tiles behind a URL never change. A sample keeps its id when
# it is rebuilt; the frontend adds the set's ``updated_at`` to the URL for that.
_TILE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}
_UNSET_FIELDS = {
    "west_deg": None,
    "south_deg": None,
    "east_deg": None,
    "north_deg": None,
    "footprint": None,
    "min_zoom": None,
    "max_zoom": None,
    "tile_format": None,
    "tile_count": None,
    "gsd_m": None,
    "size_bytes": None,
}


def _hub(request: Request) -> ImageryHub:
    return request.app.state.imagery


def _summary(item: ImagerySet) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "status": "ready",
        "source_format": item.source_format,
        "west_deg": item.west_deg,
        "south_deg": item.south_deg,
        "east_deg": item.east_deg,
        "north_deg": item.north_deg,
        "footprint": None if item.footprint is None else list(item.footprint),
        "min_zoom": item.min_zoom,
        "max_zoom": item.max_zoom,
        "tile_format": item.tile_format,
        "tile_count": item.tile_count,
        "gsd_m": item.gsd_m,
        "size_bytes": item.size_bytes,
        "attribution": item.attribution,
        "license": item.license,
        "origin": item.origin,
        "acquired_at": item.acquired_at,
        "created_at": item.created_at,
        "sensor": item.sensor,
        "label": item.label,
        "sample": item.sample,
        "updated_at": iso(item.updated_at),
        "stage": None,
        "progress": None,
        "error": None,
    }


def job_summary(job: ImportJob) -> dict[str, Any]:
    """A set that is not ready yet: what the upload said about it, and how the import is going."""
    return {
        "id": job.id,
        "status": job.status,
        **job.meta,
        **_UNSET_FIELDS,
        "label": None,
        "sample": False,
        "updated_at": job.meta["created_at"],
        "stage": job.stage if job.status == "processing" else None,
        "progress": job.progress if job.status == "processing" else None,
        "error": job.error,
    }


def _existing(request: Request, set_id: str) -> ImagerySet:
    found = _hub(request).library.get(set_id)
    if found is None:
        raise NOT_FOUND
    return found


def _own(request: Request, set_id: str) -> ImagerySet:
    """A set the user may change; samples are read-only."""
    found = _existing(request, set_id)
    if found.sample:
        raise SAMPLE_LOCKED
    return found


def check_queue(hub: ImageryHub, adding: int = 1) -> None:
    """Refuse an import when the queue cannot take ``adding`` more.

    Raises:
        ApiError: 422 ``imageryQueueFull``.
    """
    if hub.pending_count() + adding > MAX_IMPORT_QUEUE:
        raise ApiError(
            422,
            "imageryQueueFull",
            f"가져오는 중인 영상이 많음 · 동시에 {MAX_IMPORT_QUEUE}개까지 대기 가능",
            max=MAX_IMPORT_QUEUE,
        )


@router.get("/imagery/inbox")
def imagery_inbox(request: Request) -> dict:
    """Where the watched folder is and which files in it are not imported yet."""
    watcher = request.app.state.imagery_inbox
    if watcher is None:
        return {"enabled": False, "path": None, "waiting": []}
    return {"enabled": True, "path": str(watcher.root.resolve()), "waiting": watcher.waiting}


@router.get("/imagery/samples")
def imagery_samples(request: Request) -> dict:
    """Whether sample imagery is switched on, and whether the submodule holding it is there."""
    library = _hub(request).library
    count = len(library.samples(set()))
    return {"enabled": library.samples_root is not None, "present": count > 0, "count": count}


@router.get("/imagery")
def list_imagery(request: Request) -> list[dict]:
    hub = _hub(request)
    jobs = [job_summary(job) for job in hub.jobs()]
    return jobs[::-1] + [_summary(item) for item in hub.library.entries()]


@router.post("/imagery")
async def upload_imagery(
    request: Request,
    source_format: Literal["mbtiles", "image", "geotiff"],
    name: str = Query(min_length=1, max_length=MAX_NAME_LENGTH),
    attribution: str = Query("", max_length=MAX_ATTRIBUTION_LENGTH),
    license: str = Query("", max_length=MAX_LICENSE_LENGTH),
    acquired_at: datetime | None = None,
    corners_deg: str | None = Query(None, max_length=400),
    sensor: Literal["optical", "sar"] | None = None,
) -> JSONResponse:
    hub = _hub(request)
    library = hub.library
    if library.count() + len(hub.jobs()) >= MAX_IMAGERY_SETS:
        raise ApiError(
            422,
            "imageryTooMany",
            f"영상은 최대 {MAX_IMAGERY_SETS}개까지 등록 가능",
            max=MAX_IMAGERY_SETS,
        )
    if source_format != "mbtiles":
        check_queue(hub)
    try:
        corners = parse_corners(corners_deg or "") if source_format == "image" else None
    except ImageryError as error:
        raise ApiError.of(422, error) from error
    max_mb = MAX_IMAGERY_BYTES // (1024 * 1024)
    too_large = ApiError(
        413, "imageryTooLarge", f"영상 파일은 {max_mb} MB 이하만 업로드 가능", max_mb=max_mb
    )
    set_id = library.new_id()
    work_dir = library.work_dir(set_id)
    work_dir.mkdir(parents=True)
    source = work_dir / "source"
    meta: dict[str, Any] = {
        "name": name.strip() or name,
        "source_format": source_format,
        "attribution": attribution.strip(),
        "license": license.strip(),
        "origin": None,
        "acquired_at": iso(as_utc(acquired_at)) if acquired_at else None,
        "created_at": iso(datetime.now(UTC)),
        "sensor": sensor,
    }
    try:
        await stream_limited_body(request, source, MAX_IMAGERY_BYTES, too_large)
        if source_format == "mbtiles":
            info = await asyncio.to_thread(mbtiles.inspect, source)
            west_deg, south_deg, east_deg, north_deg = info.bounds_deg
            created = library.add(
                set_id,
                source,
                {
                    **meta,
                    "attribution": meta["attribution"] or info.attribution,
                    "west_deg": west_deg,
                    "south_deg": south_deg,
                    "east_deg": east_deg,
                    "north_deg": north_deg,
                    "footprint": None,
                    "min_zoom": info.min_zoom,
                    "max_zoom": info.max_zoom,
                    "tile_format": info.tile_format,
                    "tile_count": info.tile_count,
                },
            )
            library.discard_work(set_id)
            return JSONResponse(_summary(created), status_code=201)
        if corners is not None:
            warp.check_image(source)
            job = hub.submit(
                set_id, meta, lambda target, tick: warp.import_image(source, corners, target, tick)
            )
        else:
            warp.check_geotiff(source)
            job = hub.submit(
                set_id, meta, lambda target, tick: warp.import_geotiff(source, target, tick)
            )
    except ImageryError as error:
        library.discard_work(set_id)
        raise ApiError.of(422, error) from error
    except BaseException:
        library.discard_work(set_id)
        raise
    return JSONResponse(job_summary(job), status_code=202)


@router.put("/imagery/{set_id}")
def update_imagery(request: Request, set_id: str, body: ImageryUpdate) -> dict:
    current = _own(request, set_id)
    try:
        updated = _hub(request).library.update(
            set_id,
            name=body.name.strip() or body.name,
            attribution=body.attribution.strip(),
            license=current.license if body.license is None else body.license.strip(),
            acquired_at=iso(as_utc(body.acquired_at)) if body.acquired_at else None,
            sensor=current.sensor if body.sensor is None else body.sensor or None,
        )
    except PermissionError as error:
        raise BUSY from error
    if updated is None:
        raise NOT_FOUND
    return _summary(updated)


@router.delete("/imagery/{set_id}", status_code=204)
def delete_imagery(request: Request, set_id: str) -> Response:
    hub = _hub(request)
    # A set that is still importing, or whose import failed, exists only as a job.
    if hub.dismiss(set_id):
        return Response(status_code=204)
    _own(request, set_id)
    try:
        hub.library.delete(set_id)
    except PermissionError as error:
        raise BUSY from error
    return Response(status_code=204)


@router.get("/imagery/{set_id}/tiles/{z}/{x}/{y}")
def imagery_tile(request: Request, set_id: str, z: int, x: int, y: int) -> Response:
    item = _existing(request, set_id)
    data = None
    if 0 <= z <= item.max_zoom and 0 <= x < 2**z and 0 <= y < 2**z:
        data = mbtiles.read_tile(item.path, z, x, y)
    if data is None:
        # A 404 would make the globe report a failed layer; a hole is just transparent.
        data = mbtiles.TRANSPARENT_TILE
    return Response(data, media_type=mbtiles.tile_media_type(data), headers=_TILE_HEADERS)
