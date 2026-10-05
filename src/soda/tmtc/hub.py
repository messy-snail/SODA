"""The one simulation session the server runs, and the browser tabs listening to it."""

import asyncio
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from .packets import Command
from .session import Session


class TmtcHub:
    def __init__(self) -> None:
        self.session: Session | None = None
        self.clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def replace(self, session: Session | None) -> None:
        async with self._lock:
            self.session = session
        await self.broadcast([session.status() if session else {"type": "stopped"}])

    async def clock(self, now_ms: int) -> None:
        async with self._lock:
            if self.session is None:
                return
            messages = self.session.advance(now_ms)
        await self.broadcast(messages)

    async def command(self, command: Command) -> None:
        async with self._lock:
            if self.session is None:
                return
            messages = self.session.submit(command)
        await self.broadcast(messages)

    async def broadcast(self, messages: list[dict[str, Any]]) -> None:
        for client in list(self.clients):
            try:
                for message in messages:
                    await client.send_json(message)
            except (WebSocketDisconnect, RuntimeError, OSError):
                # A dropped client must not stop the others from hearing the rest.
                self.clients.discard(client)
