"""Settings screen: which database SODA uses, and switching it on the next start.

The store is opened once in the app lifespan, so a saved URL takes effect after a restart.
Only ``database_url`` in the local TOML file is ever written; an ``SODA_DATABASE_URL``
environment variable wins over it, so saving is refused while one is set.
"""

import os
import re
import tomllib
from pathlib import Path

from fastapi import APIRouter, Request

from ..gp.store import ProbeResult, probe_store, sqlite_path
from ..settings import Settings, write_local_setting
from .errors import ApiError
from .schemas import DatabaseUrlRequest

router = APIRouter()

_CREDENTIALS = re.compile(r"(://[^:/@]+):[^@/]*@")


def mask_url(url: str) -> str:
    """Hide a password in ``scheme://user:password@host`` so the screen can show the URL."""
    return _CREDENTIALS.sub(r"\1:***@", url)


def _default_url(settings: Settings) -> str:
    return Settings(data_dir=settings.data_dir).resolved_database_url


def _next_url(settings: Settings) -> str:
    """The URL the next start will open, given what is saved now."""
    if os.environ.get("SODA_DATABASE_URL"):
        return os.environ["SODA_DATABASE_URL"]
    path = settings.writable_path
    saved = ""
    if path.is_file():
        try:
            with path.open("rb") as source:
                saved = tomllib.load(source).get("database_url", "")
        except (OSError, tomllib.TOMLDecodeError):
            saved = ""
    return saved or _default_url(settings)


def _size_bytes(path: Path) -> int:
    """Database file plus its write-ahead log, which holds recent writes until checkpoint."""
    files = (path, path.with_name(path.name + "-wal"))
    return sum(file.stat().st_size for file in files if file.is_file())


def _probe(url: str) -> ProbeResult:
    try:
        return probe_store(url)
    except ValueError as error:
        raise ApiError(
            422,
            "databaseUrlInvalid",
            "지원하지 않는 데이터베이스 주소 · sqlite:///<경로> 형식으로 입력 필요",
        ) from error


def _probe_summary(url: str, result: ProbeResult) -> dict:
    return {
        "url": mask_url(url),
        "backend": result.backend,
        "path": str(result.path.resolve()) if result.path else None,
        "exists": result.exists,
        "initialized": result.initialized,
        "writable": result.writable,
        "ok": result.ok,
        "detail": result.detail,
    }


@router.get("/settings/database")
def database_status(request: Request) -> dict:
    """The database in use, its size and row counts, and what the next start will use."""
    settings: Settings = request.app.state.settings
    running = settings.resolved_database_url
    path = sqlite_path(running)
    following = _next_url(settings)
    return {
        "backend": running.partition("://")[0],
        "url": mask_url(running),
        "path": str(path.resolve()),
        "size_bytes": _size_bytes(path),
        "counts": request.app.state.gp.store.stats(),
        "source": settings.database_source,
        "settings_file": str(settings.writable_path.resolve()),
        "default_url": _default_url(settings),
        "next_url": mask_url(following),
        "restart_required": following != running,
        "editable": settings.database_source != "env",
    }


@router.post("/settings/database/test")
def test_database(body: DatabaseUrlRequest, request: Request) -> dict:
    """Check a URL without creating or migrating anything there."""
    url = body.url.strip() or _default_url(request.app.state.settings)
    return _probe_summary(url, _probe(url))


@router.put("/settings/database")
def save_database(body: DatabaseUrlRequest, request: Request) -> dict:
    """Save ``database_url`` to the local TOML file; it applies on the next start."""
    settings: Settings = request.app.state.settings
    if os.environ.get("SODA_DATABASE_URL"):
        raise ApiError(
            409,
            "databaseUrlFromEnv",
            "SODA_DATABASE_URL 환경변수가 설정돼 있어 여기서 변경 불가",
        )
    url = body.url.strip()
    result = _probe(url or _default_url(settings))
    if not result.ok:
        raise ApiError(
            422,
            "databaseProbeFailed",
            "이 경로의 데이터베이스 사용 불가",
            detail=result.detail,
        )
    # The default is stored as "no key" so the database keeps following ``data_dir``.
    write_local_setting(
        settings.writable_path, "database_url", "" if url == _default_url(settings) else url
    )
    return database_status(request)
