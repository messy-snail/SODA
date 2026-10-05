import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from soda.gp.celestrak import CelesTrakClient, interpret
from soda.gp.service import REFRESH_INTERVAL, ElementsUnavailable, GPService
from soda.gp.sqlite_store import SqliteStore

URL = "https://celestrak.org/NORAD/elements/gp.php"
NOT_UPDATED = "GP data has not updated since your last successful download of GROUP=active"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 16, 12, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, delta: timedelta) -> None:
        self.now += delta


class Upstream:
    """Scripted CelesTrak responses keyed by query, recording every request."""

    def __init__(self, record: dict) -> None:
        self.record = record
        self.requests: list[httpx.Request] = []
        self.group_responses: list[httpx.Response] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.url.params["FORMAT"] == "json"
        if "GROUP" in request.url.params:
            return self.group_responses.pop(0)
        if request.url.params["CATNR"] == str(self.record["NORAD_CAT_ID"]):
            return httpx.Response(200, json=[self.record])
        return httpx.Response(200, text="No GP data found")


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def upstream(iss_record):
    return Upstream(iss_record)


@pytest.fixture
async def service_factory(tmp_path, upstream, clock):
    clients = []

    def build() -> GPService:
        client = httpx.AsyncClient(transport=httpx.MockTransport(upstream.handler))
        clients.append(client)
        return GPService(
            SqliteStore(tmp_path / "soda.db"), CelesTrakClient(client, URL), clock=clock
        )

    yield build
    for client in clients:
        await client.aclose()


@pytest.mark.parametrize(
    ("response", "status"),
    [
        (httpx.Response(200, json=[{"NORAD_CAT_ID": 1}]), "ok"),
        (httpx.Response(200, json=[]), "not_found"),
        (httpx.Response(200, text="No GP data found"), "not_found"),
        (httpx.Response(403, text=NOT_UPDATED), "not_modified"),
        (httpx.Response(403, text="Forbidden"), "error"),
        (httpx.Response(503, text="busy"), "error"),
        (httpx.Response(200, text="<html>"), "error"),
    ],
)
def test_interpret(response, status):
    assert interpret(response).status == status


async def test_group_refresh_respects_two_hour_budget(service_factory, upstream, clock, iss_record):
    upstream.group_responses = [
        httpx.Response(200, json=[iss_record]),
        httpx.Response(403, text=NOT_UPDATED),
    ]
    service = service_factory()
    assert await service.refresh_group("active") == "ok"
    assert await service.refresh_group("active") == "skipped"

    clock.advance(timedelta(hours=1))
    restarted = service_factory()
    assert await restarted.refresh_group("active") == "skipped"

    clock.advance(REFRESH_INTERVAL)
    assert await restarted.refresh_group("active") == "not_modified"
    assert len(upstream.requests) == 2
    record = restarted.store.fetch_record("celestrak", "group:active")
    assert record.consecutive_errors == 0
    assert record.object_count == 1


async def test_errors_back_off_exponentially(service_factory, upstream, clock):
    upstream.group_responses = [httpx.Response(500) for _ in range(3)]
    service = service_factory()
    assert await service.refresh_group("active") == "error"
    clock.advance(timedelta(minutes=1))
    assert await service.refresh_group("active") == "skipped"
    clock.advance(timedelta(minutes=1))
    assert await service.refresh_group("active") == "error"
    clock.advance(timedelta(minutes=3))
    assert await service.refresh_group("active") == "skipped"
    clock.advance(timedelta(minutes=1))
    assert await service.refresh_group("active") == "error"
    assert len(upstream.requests) == 3


async def test_group_members_are_fresh_without_catnr_requests(
    service_factory, upstream, iss_record
):
    upstream.group_responses = [httpx.Response(200, json=[iss_record])]
    service = service_factory()
    await service.refresh_group("stations")
    element = await service.latest(25544)
    assert element.name == "ISS (ZARYA)"
    assert len(upstream.requests) == 1


async def test_latest_fetches_catalog_number_once(service_factory, upstream, clock):
    service = service_factory()
    assert (await service.latest(25544)).norad_id == 25544
    clock.advance(timedelta(hours=3))
    assert (await service.latest(25544)).norad_id == 25544
    clock.advance(timedelta(minutes=5))
    assert (await service.latest(25544)).norad_id == 25544
    assert [r.url.params["CATNR"] for r in upstream.requests] == ["25544", "25544"]


async def test_unknown_catalog_number(service_factory, upstream):
    service = service_factory()
    with pytest.raises(ElementsUnavailable):
        await service.latest(99999)
    with pytest.raises(ElementsUnavailable):
        await service.latest(99999)
    assert len(upstream.requests) == 1


async def test_group_payload_etag(service_factory, upstream, iss_record):
    upstream.group_responses = [httpx.Response(200, json=[iss_record])]
    service = service_factory()
    await service.refresh_group("active")
    body, etag = service.group_payload("active")
    assert json.loads(body)[0]["NORAD_CAT_ID"] == 25544
    assert service.group_payload("active") == (body, etag)


async def test_resolve_warns_for_past_start_without_space_track(service_factory, iss_record):
    service = service_factory()
    resolved = await service.resolve(25544, datetime(2026, 1, 1, tzinfo=UTC))
    assert resolved.elements.norad_id == 25544
    assert resolved.warnings[0]["code"] == "historyNeedsSpaceTrack"
