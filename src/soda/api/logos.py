"""Organization logo files served from ``data/logos`` over the ones bundled with the package."""

import asyncio

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse

from ..logos import MAX_LOGO_BYTES, LogoError, LogoStore
from ..named_files import StoredFile
from .errors import ApiError
from .schemas import iso
from .uploads import read_limited_body

router = APIRouter()

NOT_FOUND = ApiError(404, "logoNotFound", "로고 없음")
BAD_NAME = ApiError(422, "logoBadName", "로고 이름은 default, 기관 이름, NORAD 번호 중 하나여야 함")
BUSY = ApiError(409, "logoBusy", "로고 파일 사용 중 · 잠시 후 다시 시도 필요")
BUILTIN_LOCKED = ApiError(422, "logoBuiltinLocked", "기본 제공 로고는 삭제 불가")


def _store(request: Request) -> LogoStore:
    settings = request.app.state.settings
    return LogoStore(settings.logos_dir, settings.builtin_logos_dir)


def _info(store: LogoStore, logo: StoredFile) -> dict:
    return {
        "name": logo.name,
        "norad_id": logo.norad_id,
        "operator": logo.operator,
        "builtin": logo.builtin,
        "has_builtin": store.has_builtin(logo.name),
        "size_bytes": logo.size_bytes,
        "updated_at": iso(logo.updated_at),
    }


def _existing(store: LogoStore, name: str) -> StoredFile:
    logo = store.get(name) if store.is_valid(name) else None
    if logo is None:
        raise NOT_FOUND
    return logo


@router.get("/logos")
def list_logos(request: Request) -> list[dict]:
    store = _store(request)
    return [_info(store, logo) for logo in store.entries()]


@router.get("/logos/{name}.png")
def logo_file(request: Request, name: str) -> FileResponse:
    logo = _existing(_store(request), name)
    return FileResponse(logo.path, media_type="image/png")


@router.put("/logos/{name}")
async def upload_logo(request: Request, name: str) -> dict:
    store = _store(request)
    if not store.is_valid(name):
        raise BAD_NAME
    too_large = ApiError(
        413,
        "logoTooLarge",
        f"로고 파일은 {MAX_LOGO_BYTES // (1024 * 1024)} MB 이하만 업로드 가능",
        max_mb=MAX_LOGO_BYTES // (1024 * 1024),
    )
    body = await read_limited_body(request, MAX_LOGO_BYTES, too_large)
    try:
        logo = await asyncio.to_thread(store.save, name, body)
    except LogoError as error:
        raise ApiError.of(422, error) from error
    except PermissionError as error:
        raise BUSY from error
    return _info(store, logo)


@router.delete("/logos/{name}", status_code=204)
def delete_logo(request: Request, name: str) -> Response:
    """Remove an uploaded logo. A bundled logo underneath it becomes visible again."""
    store = _store(request)
    if _existing(store, name).builtin:
        raise BUILTIN_LOCKED
    try:
        store.delete(name)
    except PermissionError as error:
        raise BUSY from error
    return Response(status_code=204)
