from datetime import UTC, datetime
from urllib.parse import parse_qs

import httpx
import pytest

from soda.gp.spacetrack import RateLimited, SlidingWindowLimiter, SpaceTrackClient


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value


def test_limiter_enforces_every_window():
    clock = FakeClock()
    limiter = SlidingWindowLimiter(((2, 60.0), (3, 3600.0)), clock)
    limiter.acquire()
    limiter.acquire()
    with pytest.raises(RateLimited):
        limiter.acquire()
    clock.value = 61
    limiter.acquire()
    clock.value = 122
    with pytest.raises(RateLimited):
        limiter.acquire()
    clock.value = 3601
    limiter.acquire()


async def test_login_encodes_credentials_and_retries_after_expiry(iss_record):
    seen: list[httpx.Request] = []
    responses = iter([401, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/ajaxauth/login":
            return httpx.Response(200, text='""')
        return httpx.Response(next(responses), json=[iss_record])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = SpaceTrackClient(http, "me@example.com", "p&ss=word#1")
        records = await client.gp_history(
            25544, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 3, tzinfo=UTC)
        )

    assert records == [iss_record]
    login = parse_qs(seen[0].content.decode())
    assert login == {"identity": ["me@example.com"], "password": ["p&ss=word#1"]}
    paths = [request.url.path for request in seen]
    assert paths.count("/ajaxauth/login") == 2
    assert "/NORAD_CAT_ID/25544/EPOCH/2026-01-01T00:00:00--2026-01-03T00:00:00/" in paths[1]
