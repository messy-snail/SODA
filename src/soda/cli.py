"""SODA command line."""

import argparse
import asyncio
import logging
import os
from pathlib import Path

import httpx
import uvicorn

from .app import USER_AGENT, create_app
from .gp.celestrak import CelesTrakClient
from .gp.service import GPService
from .gp.store import open_store
from .settings import Settings


def _serve(args: argparse.Namespace) -> None:
    settings = Settings.read(args.settings)
    host = args.bind or settings.bind
    port = args.port or settings.port
    if args.reload:
        if args.settings:
            os.environ["SODA_SETTINGS"] = str(args.settings)
        uvicorn.run(
            "soda.app:create_default_app",
            factory=True,
            host=host,
            port=port,
            reload=True,
            reload_dirs=[str(Path(__file__).parent)],
        )
        return
    uvicorn.run(create_app(settings), host=host, port=port)


async def _refresh(settings: Settings, groups: list[str]) -> None:
    store = open_store(settings.resolved_database_url)
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        service = GPService(store, CelesTrakClient(client, settings.celestrak_url))
        for group in groups:
            result = await service.refresh_group(group)
            print(f"{group}: {result} (cached objects: {store.count_latest():,})")


def main() -> None:
    parser = argparse.ArgumentParser(prog="soda", description="SODA 궤도 분석 서버")
    parser.add_argument(
        "--settings", type=Path, help="settings TOML (default: settings.local.toml)"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser("serve", help="API와 빌드된 프런트엔드를 실행합니다")
    serve.add_argument("--bind", help="bind address (default: settings bind, 127.0.0.1)")
    serve.add_argument("--port", type=int, help="port (default: settings port, 1992)")
    serve.add_argument("--reload", action="store_true", help="코드 변경 시 자동 재시작")

    refresh = commands.add_parser(
        "refresh", help="CelesTrak 그룹을 한 번 갱신합니다 (2시간 규칙 준수)"
    )
    refresh.add_argument("groups", nargs="*", default=None)

    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    if args.command == "serve":
        _serve(args)
    else:
        settings = Settings.read(args.settings)
        asyncio.run(_refresh(settings, args.groups or list(settings.refresh_groups)))


if __name__ == "__main__":
    main()
