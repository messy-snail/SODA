"""Catalogue search and import against a fake Maxar bucket and a fake OpenAerialMap API.

Nothing here touches the network: every request goes to an ``httpx.MockTransport`` that
records what was asked for.
"""

import io
import time
from contextlib import contextmanager

import httpx
import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from soda.app import create_app
from soda.imagery.catalog import maxar, oam
from soda.imagery.catalog.cache import JsonCache
from soda.imagery.catalog.http import CatalogHttp, is_allowed
from soda.imagery.formats import ImageryError
from soda.settings import Settings

MAXAR = "https://maxar-opendata.s3.amazonaws.com/events"
NOTO = "Japan-Earthquake-Jan-2024"
#: Two tiles of one acquisition near Wajima, and a second acquisition further east.
TILE_A = [137.05, 37.47, 137.09, 37.50]
TILE_B = [137.09, 37.47, 137.15, 37.51]
TILE_C = [138.97, 37.80, 139.08, 37.89]
ITEM_A = f"{NOTO}/53/120022100102/2024-01-02/10300100F2BE1300"
OAM_ID = "5da7041eb4c6e100054ddb58"
OAM_TIF = "https://oin-hotosm-temp.s3.amazonaws.com/5da7041eb4c6e100054ddb57/0/scene.tif"


def geotiff(box: list[float]) -> bytes:
    """A tiny RGB GeoTIFF filling a lon/lat box."""
    west, south, east, north = box
    buffer = io.BytesIO()
    with rasterio.open(
        buffer,
        "w",
        driver="GTiff",
        width=32,
        height=32,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_origin(west, north, (east - west) / 32, (north - south) / 32),
    ) as target:
        target.write(np.full((3, 32, 32), 140, np.uint8))
    return buffer.getvalue()


def maxar_documents() -> dict[str, dict]:
    """The fake bucket: two events, the first with two acquisitions and three tiles."""

    def item(catalog: str, box: list[float]) -> dict:
        return {
            "bbox": box,
            "properties": {
                "datetime": "2024-01-02 01:57:43Z",
                "platform": "WV02",
                "gsd": 0.54,
                "tile:clouds_percent": 3,
            },
            "assets": {"visual": {"href": f"./{catalog}-visual.tif", "proj:shape": [17408, 17408]}},
        }

    ard = f"{MAXAR}/{NOTO}/ard"
    return {
        f"{MAXAR}/catalog.json": {
            "links": [
                {"rel": "child", "href": f"./{NOTO}/collection.json"},
                {"rel": "child", "href": "./Floods-Spain-Oct24/collection.json"},
                {"rel": "root", "href": "./catalog.json"},
            ]
        },
        f"{MAXAR}/{NOTO}/collection.json": {
            "title": "Japan Earthquake Jan 2024",
            "extent": {
                "spatial": {
                    "bbox": [[137.05, 37.47, 139.08, 37.89], [137.05, 37.47, 137.15, 37.51], TILE_C]
                }
            },
            "links": [
                {
                    "rel": "child",
                    "href": "./ard/acquisition_collections/10300100F2BE1300_collection.json",
                },
                {
                    "rel": "child",
                    "href": "./ard/acquisition_collections/10200100E6723900_collection.json",
                },
            ],
        },
        f"{MAXAR}/Floods-Spain-Oct24/collection.json": {
            "title": "Floods Spain Oct 2024",
            "extent": {"spatial": {"bbox": [[-0.6, 39.2, -0.2, 39.6], [-0.6, 39.2, -0.2, 39.6]]}},
            "links": [
                {
                    "rel": "child",
                    "href": "./ard/acquisition_collections/10400100AAAAAAAA_collection.json",
                }
            ],
        },
        f"{ard}/acquisition_collections/10300100F2BE1300_collection.json": {
            "extent": {"spatial": {"bbox": [TILE_A, TILE_B]}},
            "links": [
                {"rel": "item", "href": "../53/120022100102/2024-01-02/10300100F2BE1300.json"},
                {"rel": "item", "href": "../53/120022100103/2024-01-02/10300100F2BE1300.json"},
            ],
        },
        f"{ard}/acquisition_collections/10200100E6723900_collection.json": {
            "extent": {"spatial": {"bbox": [TILE_C]}},
            "links": [
                {"rel": "item", "href": "../54/031133011210/2023-08-29/10200100E6723900.json"}
            ],
        },
        f"{ard}/53/120022100102/2024-01-02/10300100F2BE1300.json": item("10300100F2BE1300", TILE_A),
        f"{ard}/53/120022100103/2024-01-02/10300100F2BE1300.json": item("10300100F2BE1300", TILE_B),
    }


class Upstream:
    """A mock transport handler that serves documents and files and remembers every request."""

    def __init__(self) -> None:
        self.documents: dict[str, object] = maxar_documents()
        self.files: dict[str, httpx.Response] = {
            f"{MAXAR}/{NOTO}/ard/53/120022100102/2024-01-02/10300100F2BE1300-visual.tif": (
                httpx.Response(200, content=geotiff(TILE_A))
            ),
            OAM_TIF: httpx.Response(200, content=geotiff([126.5, 33.5, 126.53, 33.52])),
        }
        self.requests: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        plain = url.split("?")[0]
        if plain in self.files:
            original = self.files[plain]
            return httpx.Response(
                original.status_code, headers=original.headers, content=original.content
            )
        if url in self.documents or plain in self.documents:
            return httpx.Response(200, json=self.documents.get(url, self.documents.get(plain)))
        return httpx.Response(404, json={"error": "not found"})


@pytest.fixture
def upstream():
    return Upstream()


@pytest.fixture
def lookups(upstream, tmp_path):
    """The HTTP layer and cache on their own, with a clock the test can move."""
    now = [1_000_000.0]
    client = httpx.Client(transport=httpx.MockTransport(upstream))
    yield CatalogHttp(client), JsonCache(tmp_path / "cache", lambda: now[0]), now
    client.close()


@contextmanager
def serving(tmp_path, builtin_logos, upstream):
    settings = Settings(
        data_dir=tmp_path,
        auto_refresh=False,
        builtin_logos_dir=builtin_logos,
        imagery_inbox=False,
        source_path=tmp_path / "settings.local.toml",
    )
    app = create_app(settings, transport=httpx.MockTransport(upstream), static=tmp_path / "none")
    with TestClient(app) as client:
        yield client


@pytest.fixture
def api(tmp_path, builtin_logos, upstream):
    with serving(tmp_path, builtin_logos, upstream) as client:
        yield client


def settled(client, timeout_s: float = 20.0) -> list[dict]:
    """The imagery list once nothing in it is still being imported."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        items = client.get("/api/v1/imagery").json()
        if all(item["status"] != "processing" for item in items):
            return items
        time.sleep(0.05)
    raise AssertionError("imports did not finish")


@pytest.mark.parametrize(
    ("source", "url", "allowed"),
    [
        ("maxar", f"{MAXAR}/catalog.json", True),
        ("maxar", "https://maxar-opendata.s3.us-west-2.amazonaws.com/events/x.tif", True),
        ("maxar", "http://maxar-opendata.s3.amazonaws.com/events/catalog.json", False),
        ("maxar", "https://maxar-opendata.s3.amazonaws.com:8443/events/catalog.json", False),
        ("maxar", "https://user@maxar-opendata.s3.amazonaws.com/events/catalog.json", False),
        ("maxar", "https://maxar-opendata.s3.amazonaws.com.evil.example/x", False),
        ("maxar", "https://evil.example/maxar-opendata.s3.amazonaws.com", False),
        ("maxar", "https://api.openaerialmap.org/meta", False),
        ("oam", "https://api.openaerialmap.org/meta", True),
        ("oam", "https://oin-hotosm-temp.s3.us-east-1.amazonaws.com/a/0/b.tif", True),
        ("oam", "https://oin-hotosm.s3.amazonaws.com/a/0/b.tif", True),
        ("oam", "https://tiles.openaerialmap.org/a/0/b.tif", False),
        ("other", f"{MAXAR}/catalog.json", False),
        ("oam", "file:///etc/passwd", False),
        ("oam", "https://127.0.0.1/meta", False),
    ],
)
def test_only_https_to_listed_hosts_is_allowed(source, url, allowed):
    assert is_allowed(source, url) is allowed


def test_maxar_search_finds_tiles_from_cached_documents(lookups, upstream):
    http, cache, _now = lookups
    found = maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))

    assert [item.item_id for item in found] == [
        ITEM_A,
        f"{NOTO}/53/120022100103/2024-01-02/10300100F2BE1300",
    ]
    first = found[0]
    assert first.title == "Japan Earthquake Jan 2024 2024-01-02 0102"
    assert (first.west_deg, first.north_deg) == (137.05, 37.50)
    assert (first.license, first.attribution) == ("CC BY-NC 4.0", "Maxar Open Data Program")
    # Filled in from the tile's own document.
    assert (first.gsd_m, first.clouds_percent, first.pixels) == (0.54, 3.0, 17408 * 17408)
    assert first.acquired_at == "2024-01-02T01:57:43Z"
    # Root, both events, the one acquisition that touches the box, and its two tiles.
    assert len(upstream.requests) == 6
    assert not any("10200100E6723900" in url for url in upstream.requests)

    upstream.requests.clear()
    assert len(maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))) == 2
    assert upstream.requests == []


def test_maxar_search_outside_every_event_asks_for_no_acquisition(lookups, upstream):
    http, cache, _now = lookups
    assert maxar.search(http, cache, (126.0, 36.0, 127.0, 37.0)) == []
    assert len(upstream.requests) == 3


def test_maxar_documents_are_refetched_once_stale(lookups, upstream):
    http, cache, now = lookups
    maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))
    upstream.requests.clear()

    now[0] += 2 * 24 * 3600
    maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))
    # Only the root is a day old; events last a week, tiles for good.
    assert upstream.requests == [f"{MAXAR}/catalog.json"]


def test_maxar_tolerates_an_event_that_cannot_be_read(lookups, upstream):
    http, cache, _now = lookups
    del upstream.documents[f"{MAXAR}/Floods-Spain-Oct24/collection.json"]
    assert len(maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))) == 2


def test_maxar_accepts_an_overall_box_before_the_tile_boxes(lookups, upstream):
    """Newer events list the acquisition's own box first, then one per tile."""
    http, cache, _now = lookups
    url = f"{MAXAR}/{NOTO}/ard/acquisition_collections/10300100F2BE1300_collection.json"
    boxes = upstream.documents[url]["extent"]["spatial"]["bbox"]
    boxes.insert(0, [137.05, 37.47, 137.15, 37.51])
    found = maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))
    assert [(item.west_deg, item.east_deg) for item in found] == [
        (137.05, 137.09),
        (137.09, 137.15),
    ]


def test_maxar_skips_an_acquisition_whose_boxes_cannot_be_paired(lookups, upstream):
    http, cache, _now = lookups
    url = f"{MAXAR}/{NOTO}/ard/acquisition_collections/10300100F2BE1300_collection.json"
    upstream.documents[url]["extent"]["spatial"]["bbox"] = [TILE_A]
    assert maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6)) == []


def test_maxar_falls_back_when_boxes_do_not_pair_with_acquisitions(lookups, upstream):
    http, cache, _now = lookups
    event = upstream.documents[f"{MAXAR}/{NOTO}/collection.json"]
    event["extent"]["spatial"]["bbox"] = event["extent"]["spatial"]["bbox"][:1]
    found = maxar.search(http, cache, (137.0, 37.4, 137.2, 37.6))
    # Without a box per acquisition every acquisition is read, and the tiles still filter.
    assert len(found) == 2
    assert any("10200100E6723900" in url for url in upstream.requests)


@pytest.mark.parametrize(
    "item_id",
    [
        "",
        "Japan/../../etc/passwd",
        f"{NOTO}/53/120022100102/2024-01-02",
        f"{NOTO}/53/120022100102/2024-01-02/10300100F2BE1300/extra",
        f"{NOTO}/53/12002210010X/2024-01-02/10300100F2BE1300",
        "Unknown-Event/53/120022100102/2024-01-02/10300100F2BE1300",
    ],
)
def test_maxar_resolve_rejects_ids_it_cannot_place(lookups, item_id):
    http, cache, _now = lookups
    with pytest.raises(ImageryError) as caught:
        maxar.resolve(http, cache, item_id)
    assert caught.value.code == "imageryCatalogItemUnknown"


def test_maxar_resolve_builds_the_address_itself(lookups, upstream):
    http, cache, _now = lookups
    resolved = maxar.resolve(http, cache, ITEM_A)
    assert resolved.url == (
        f"{MAXAR}/{NOTO}/ard/53/120022100102/2024-01-02/10300100F2BE1300-visual.tif"
    )
    assert resolved.name == "Japan Earthquake Jan 2024 2024-01-02 0102"
    assert resolved.acquired_at == "2024-01-02T01:57:43Z"

    # An asset pointing anywhere but beside its item is not followed.
    item_url = f"{MAXAR}/{NOTO}/ard/53/120022100103/2024-01-02/10300100F2BE1300.json"
    upstream.documents[item_url]["assets"]["visual"]["href"] = "https://evil.example/x.tif"
    with pytest.raises(ImageryError) as caught:
        maxar.resolve(http, cache, f"{NOTO}/53/120022100103/2024-01-02/10300100F2BE1300")
    assert caught.value.code == "imageryCatalogItemUnknown"


def oam_result(**changes) -> dict:
    return {
        "_id": OAM_ID,
        "uuid": OAM_TIF,
        "title": "Jeju old town",
        "provider": "Jeju Urban Regeneration Center",
        "bbox": [126.5, 33.5, 126.53, 33.52],
        "gsd": 0.05,
        "file_size": 5_000_000,
        "acquisition_start": "2019-10-12T00:00:00.000Z",
        "properties": {"license": "CC-BY 4.0"},
        **changes,
    }


def test_oam_search_is_one_cached_request(lookups, upstream):
    http, cache, _now = lookups
    url = "https://api.openaerialmap.org/meta?bbox=126.000,33.000,127.000,34.000&limit=50&order_by=gsd&sort=asc"
    huge = oam_result(_id="5da7041eb4c6e100054ddb59", file_size=3_231_859_293)
    elsewhere = oam_result(_id="5da7041eb4c6e100054ddb5a", uuid="https://example.com/a.tif")
    broken = oam_result(_id="not-an-id")
    upstream.documents[url] = {"results": [oam_result(), huge, elsewhere, broken, "junk"]}

    found = oam.search(http, cache, (126.0, 33.0, 127.0, 34.0))

    assert [(item.item_id[-2:], item.importable, item.reason) for item in found] == [
        ("58", True, None),
        ("59", False, "tooLarge"),
        ("5a", False, "hostNotAllowed"),
    ]
    first = found[0]
    assert (first.title, first.gsd_m, first.license) == ("Jeju old town", 0.05, "CC-BY 4.0")
    assert first.attribution == "Jeju Urban Regeneration Center / OpenAerialMap"
    assert upstream.requests == [url]
    oam.search(http, cache, (126.0, 33.0, 127.0, 34.0))
    assert upstream.requests == [url]


def test_a_failed_lookup_is_not_repeated_at_once(lookups, upstream):
    http, cache, _now = lookups
    for _attempt in range(3):
        with pytest.raises(ImageryError) as caught:
            oam.search(http, cache, (1.0, 1.0, 2.0, 2.0))
        assert caught.value.code == "imageryCatalogUnavailable"
        assert caught.value.params == {"source": "oam"}
    assert len(upstream.requests) == 1


def test_search_endpoint(api, upstream):
    box = {"west_deg": 137.0, "south_deg": 37.4, "east_deg": 137.2, "north_deg": 37.6}
    response = api.get("/api/v1/imagery/catalog/search", params={"source": "maxar", **box})
    assert response.status_code == 200
    body = response.json()
    assert (body["source"], body["found"], body["truncated"]) == ("maxar", 2, False)
    assert body["results"][0]["item_id"] == ITEM_A
    assert body["results"][0]["importable"] is True

    wide = {**box, "east_deg": 170.0}
    too_wide = api.get("/api/v1/imagery/catalog/search", params={"source": "maxar", **wide})
    assert too_wide.status_code == 422
    assert too_wide.json()["detail"]["code"] == "imageryCatalogAreaTooLarge"
    assert too_wide.json()["detail"]["params"] == {"max_deg": 20}

    flipped = {**box, "west_deg": 138.0}
    assert (
        api.get("/api/v1/imagery/catalog/search", params={"source": "maxar", **flipped}).status_code
        == 422
    )
    unknown = api.get("/api/v1/imagery/catalog/search", params={"source": "bing", **box})
    assert unknown.json()["detail"]["code"] == "invalidRequest"

    down = api.get("/api/v1/imagery/catalog/search", params={"source": "oam", **box})
    assert down.status_code == 502
    assert down.json()["detail"]["code"] == "imageryCatalogUnavailable"


def test_import_from_maxar_end_to_end(api, upstream, tmp_path):
    response = api.post(
        "/api/v1/imagery/catalog/import", json={"source": "maxar", "item_ids": [ITEM_A, ITEM_A]}
    )
    assert response.status_code == 202
    body = response.json()
    assert body["skipped"] == []
    (queued,) = body["queued"]
    assert queued["status"] == "processing"
    assert queued["origin"] == f"maxar:{ITEM_A}"
    assert queued["name"] == "Japan Earthquake Jan 2024 2024-01-02 0102"

    (item,) = settled(api)
    assert item["status"] == "ready"
    assert item["name"] == "Japan Earthquake Jan 2024 2024-01-02 0102"
    assert (item["attribution"], item["license"]) == ("Maxar Open Data Program", "CC BY-NC 4.0")
    assert item["acquired_at"] == "2024-01-02T01:57:43Z"
    assert item["origin"] == f"maxar:{ITEM_A}"
    assert (item["sensor"], item["sample"]) == ("optical", False)
    # The catalogue's own figure, not the finer grid the tile was resampled to.
    assert item["gsd_m"] == 0.54
    assert (item["west_deg"], item["north_deg"]) == pytest.approx((137.05, 37.50), abs=1e-6)
    assert item["tile_count"] > 0
    # The download and its scratch directory are gone.
    assert list((tmp_path / "imagery" / ".work").iterdir()) == []
    assert all(url.startswith(f"{MAXAR}/") for url in upstream.requests)

    again = api.post(
        "/api/v1/imagery/catalog/import", json={"source": "maxar", "item_ids": [ITEM_A]}
    )
    assert again.status_code == 202
    assert again.json() == {
        "queued": [],
        "skipped": [{"item_id": ITEM_A, "code": "alreadyImported"}],
    }


def test_import_from_oam(api, upstream):
    upstream.documents[f"https://api.openaerialmap.org/meta/{OAM_ID}"] = {"results": oam_result()}
    response = api.post(
        "/api/v1/imagery/catalog/import", json={"source": "oam", "item_ids": [OAM_ID]}
    )
    assert response.status_code == 202
    (item,) = settled(api)
    assert item["status"] == "ready"
    assert item["name"] == "Jeju old town"
    assert item["license"] == "CC-BY 4.0"
    assert item["origin"] == f"oam:{OAM_ID}"


def test_ids_are_checked_before_anything_is_asked_for(api, upstream):
    for source, item_id in (("maxar", "../../etc/passwd"), ("oam", "https://example.com/a.tif")):
        response = api.post(
            "/api/v1/imagery/catalog/import", json={"source": source, "item_ids": [item_id]}
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "imageryCatalogItemUnknown"
    too_many = api.post(
        "/api/v1/imagery/catalog/import",
        json={"source": "oam", "item_ids": [f"{index:024x}" for index in range(11)]},
    )
    assert too_many.json()["detail"]["code"] == "invalidRequest"
    assert upstream.requests == []
    assert api.get("/api/v1/imagery").json() == []


def failed_import(api, source: str, item_id: str) -> dict:
    api.post("/api/v1/imagery/catalog/import", json={"source": source, "item_ids": [item_id]})
    (item,) = settled(api)
    assert item["status"] == "failed"
    return item["error"]


def test_a_redirect_is_not_followed(api, upstream):
    tif = f"{MAXAR}/{NOTO}/ard/53/120022100102/2024-01-02/10300100F2BE1300-visual.tif"
    upstream.files[tif] = httpx.Response(302, headers={"Location": "https://evil.example/x.tif"})
    assert failed_import(api, "maxar", ITEM_A)["code"] == "imageryDownloadFailed"
    assert not any("evil.example" in url for url in upstream.requests)


def test_a_download_larger_than_the_limit_is_refused(api, upstream, monkeypatch, tmp_path):
    monkeypatch.setattr("soda.imagery.catalog.service.MAX_IMAGERY_BYTES", 100)
    error = failed_import(api, "maxar", ITEM_A)
    assert error["code"] == "imageryTooLarge"
    assert list((tmp_path / "imagery" / ".work").iterdir()) == []


def test_an_address_outside_the_allow_list_is_never_fetched(api, upstream):
    upstream.documents[f"https://api.openaerialmap.org/meta/{OAM_ID}"] = {
        "results": oam_result(uuid="https://internal.example/secret.tif")
    }
    assert failed_import(api, "oam", OAM_ID)["code"] == "imageryDownloadNotAllowed"
    assert not any("internal.example" in url for url in upstream.requests)


def test_an_item_the_catalogue_does_not_have_fails_the_job(api, upstream):
    missing = f"{NOTO}/53/120022100111/2024-01-02/10300100F2BE1300"
    assert failed_import(api, "maxar", missing)["code"] == "imageryCatalogUnavailable"
    # Dismissing it clears the row, as for any failed import.
    (item,) = api.get("/api/v1/imagery").json()
    assert api.delete(f"/api/v1/imagery/{item['id']}").status_code == 204
    assert api.get("/api/v1/imagery").json() == []
