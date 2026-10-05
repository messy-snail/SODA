"""FastAPI application factory."""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import (
    access,
    catalog,
    coverage,
    custom_elements,
    custom_ephemerides,
    custom_states,
    database,
    imagery,
    imagery_catalog,
    logos,
    models3d,
    orbit,
    passes,
    power,
    sensor_presets,
    stations,
    tmtc,
)
from .api import settings as settings_api
from .api.errors import ApiError
from .errors import CodedError, message
from .gp.celestrak import CelesTrakClient
from .gp.service import GPService
from .gp.spacetrack import SpaceTrackClient
from .gp.store import open_store
from .imagery.catalog.service import CatalogService
from .imagery.inbox import InboxWatcher
from .imagery.jobs import ImageryHub
from .imagery.library import ImageryLibrary
from .settings import Settings
from .tmtc.hub import TmtcHub

logger = logging.getLogger(__name__)
STATIC = Path(__file__).with_name("static") / "dist"
USER_AGENT = f"SODA/{__version__} (local orbit analysis tool)"


INBOX_SCAN_S = 5.0


async def _watch_inbox(watcher: InboxWatcher) -> None:
    """Look into the imagery inbox every few seconds for as long as the server runs."""
    while True:
        try:
            await asyncio.to_thread(watcher.scan_once)
        except Exception:
            logger.exception("Imagery inbox scan failed")
        await asyncio.sleep(INBOX_SCAN_S)


def create_app(
    settings: Settings | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    static: Path = STATIC,
) -> FastAPI:
    """Build the API and, when a frontend build exists, serve it from ``/``.

    Args:
        settings: Resolved settings. Defaults to ``Settings.read()``.
        transport: Optional HTTP transport for tests.
        static: Built SPA directory.
    """
    settings = settings or Settings.read()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = open_store(settings.resolved_database_url)
        headers = {"User-Agent": USER_AGENT}
        async with (
            httpx.AsyncClient(transport=transport, headers=headers) as client,
            httpx.AsyncClient(transport=transport, headers=headers) as spacetrack_client,
        ):
            # Catalogue lookups and downloads run on worker threads, so this client is the
            # blocking kind. The test transport serves both kinds.
            catalog_client = httpx.Client(transport=transport, headers=headers)
            spacetrack = None
            if settings.spacetrack.enabled:
                spacetrack = SpaceTrackClient(
                    spacetrack_client, settings.spacetrack.username, settings.spacetrack.password
                )
            app.state.settings = settings
            app.state.tmtc = TmtcHub()
            library = ImageryLibrary(settings.imagery_dir, settings.imagery_samples_dir)
            library.sweep()
            app.state.imagery = ImageryHub(library)
            app.state.imagery_catalog = CatalogService(
                catalog_client, settings.imagery_dir / ".cache" / "catalog"
            )
            app.state.imagery_inbox = None
            inbox_task = None
            if settings.imagery_inbox:
                watcher = InboxWatcher(app.state.imagery, settings.imagery_dir / "inbox")
                watcher.recover()
                app.state.imagery_inbox = watcher
                inbox_task = asyncio.create_task(_watch_inbox(watcher))
            app.state.gp = GPService(
                store, CelesTrakClient(client, settings.celestrak_url), spacetrack
            )
            task = None
            if settings.auto_refresh and settings.refresh_groups:
                task = asyncio.create_task(app.state.gp.refresh_forever(settings.refresh_groups))
            try:
                yield
            finally:
                if inbox_task:
                    inbox_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await inbox_task
                app.state.imagery.shutdown()
                catalog_client.close()
                if task:
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await task

    app = FastAPI(title="SODA", version=__version__, lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "If-None-Match"],
        expose_headers=["ETag"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.get("/api/v1/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    @app.exception_handler(RequestValidationError)
    def invalid_request(_request: Request, error: RequestValidationError) -> JSONResponse:
        """Keep pydantic's own English text out of the UI and give it a code to translate.

        A validator that raises a ``CodedError`` keeps its own code, so a rejected horizon
        mask still explains which rule it broke.
        """
        for item in error.errors():
            cause = (item.get("ctx") or {}).get("error")
            if isinstance(cause, CodedError):
                return JSONResponse(status_code=422, content={"detail": cause.as_message()})
        fields = [".".join(str(part) for part in item["loc"][1:]) for item in error.errors()]
        return JSONResponse(
            status_code=422,
            content={"detail": message("invalidRequest", "요청 값 확인 필요", fields=fields)},
        )

    for module in (
        access,
        passes,
        catalog,
        custom_elements,
        custom_ephemerides,
        custom_states,
        orbit,
        stations,
        sensor_presets,
        models3d,
        logos,
        imagery,
        imagery_catalog,
        settings_api,
        database,
        tmtc,
        power,
        coverage,
    ):
        app.include_router(module.router, prefix="/api/v1")

    @app.get("/api/{path:path}", include_in_schema=False)
    def unknown_api(path: str):
        raise ApiError(404, "apiNotFound", "API 없음")

    if (static / "index.html").is_file():
        app.mount("/", StaticFiles(directory=static, html=True), name="spa")
    else:

        @app.get("/", include_in_schema=False)
        def frontend_missing():
            raise ApiError(503, "frontendNotBuilt", "프런트엔드 빌드 필요 (frontend: pnpm build)")

    return app


def create_default_app() -> FastAPI:
    """Factory used by ``uvicorn --reload``."""
    return create_app()
