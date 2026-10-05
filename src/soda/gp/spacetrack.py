"""Optional Space-Track client for historical element sets.

Space-Track allows at most 30 requests per minute and 300 per hour per account.
"""

import asyncio
import logging
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://www.space-track.org"
LIMITS = ((30, 60.0), (300, 3600.0))


class SpaceTrackError(RuntimeError):
    """Raised when Space-Track cannot serve a request."""


class RateLimited(SpaceTrackError):
    """Raised when a request would exceed the account budget."""


class SlidingWindowLimiter:
    """Refuses requests that would exceed any ``(count, seconds)`` window."""

    def __init__(
        self,
        limits: tuple[tuple[int, float], ...] = LIMITS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limits = limits
        self._clock = clock
        self._stamps: deque[float] = deque()

    def acquire(self) -> None:
        now = self._clock()
        longest = max(seconds for _, seconds in self._limits)
        while self._stamps and now - self._stamps[0] >= longest:
            self._stamps.popleft()
        for count, seconds in self._limits:
            if sum(1 for stamp in self._stamps if now - stamp < seconds) >= count:
                raise RateLimited(f"Space-Track limit of {count} requests per {seconds:.0f}s")
        self._stamps.append(now)


def _fmt(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")


class SpaceTrackClient:
    """Keeps one authenticated session and refuses to exceed the request budget."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        username: str,
        password: str,
        limiter: SlidingWindowLimiter | None = None,
    ) -> None:
        self._client = client
        self._username = username
        self._password = password
        self._limiter = limiter or SlidingWindowLimiter()
        self._logged_in = False
        self._lock = asyncio.Lock()

    async def _login(self) -> None:
        self._limiter.acquire()
        response = await self._client.post(
            f"{BASE_URL}/ajaxauth/login",
            data={"identity": self._username, "password": self._password},
            timeout=30,
        )
        if response.status_code != 200 or "Failed" in response.text:
            raise SpaceTrackError("Space-Track login failed")
        self._logged_in = True

    async def _query(self, path: str) -> list[dict[str, Any]]:
        async with self._lock:
            if not self._logged_in:
                await self._login()
            self._limiter.acquire()
            response = await self._client.get(f"{BASE_URL}{path}", timeout=60)
            if response.status_code == 401:
                self._logged_in = False
                await self._login()
                self._limiter.acquire()
                response = await self._client.get(f"{BASE_URL}{path}", timeout=60)
        if response.status_code != 200:
            raise SpaceTrackError(f"Space-Track HTTP {response.status_code}")
        payload = response.json()
        if not isinstance(payload, list):
            raise SpaceTrackError("unexpected Space-Track response")
        return payload

    async def gp_history(
        self, norad_id: int, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """Return element sets for one object with epochs in ``[start, end]``."""
        path = (
            "/basicspacedata/query/class/gp_history"
            f"/NORAD_CAT_ID/{norad_id}/EPOCH/{_fmt(start)}--{_fmt(end)}"
            "/orderby/EPOCH asc/format/json"
        )
        records = await self._query(path)
        logger.info("Space-Track gp_history %s -> %d records", norad_id, len(records))
        return records
