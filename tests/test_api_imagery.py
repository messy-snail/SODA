import json
import math
import subprocess
import sys
import time

import pytest

from soda.imagery import mbtiles
from soda.imagery.limits import MAX_IMAGERY_BYTES, MAX_IMAGERY_SETS
from soda.imagery.tiling import tiles_bounds_deg

QUAD = "126.0,37.6,126.8,37.75,126.95,37.1,126.15,36.95"
BINARY = {"Content-Type": "application/octet-stream"}


def upload(client, content: bytes, **params):
    return client.post("/api/v1/imagery", params=params, content=content, headers=BINARY)


@pytest.fixture
def tiles_file(tmp_path, make_mbtiles, make_png):
    """MBTiles bytes with one level-4 tile and the four level-5 tiles below it."""
    png = make_png()
    tiles = {(4, 13, 6): png, **{(5, 26 + dx, 12 + dy): png for dx in (0, 1) for dy in (0, 1)}}
    return make_mbtiles(tmp_path / "upload.mbtiles", tiles, attribution="Tile maker").read_bytes()


def wait_until_settled(client, set_id: str, timeout_s: float = 20.0) -> dict:
    """Poll the list until an import leaves ``processing``."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        items = {item["id"]: item for item in client.get("/api/v1/imagery").json()}
        if set_id not in items or items[set_id]["status"] != "processing":
            return items.get(set_id, {})
        time.sleep(0.05)
    raise AssertionError("import did not finish")


def test_mbtiles_upload_list_tile_edit_delete(bare_client, tmp_path, tiles_file, make_png):
    assert bare_client.get("/api/v1/imagery").json() == []

    created = upload(bare_client, tiles_file, source_format="mbtiles", name=" Daejeon ")
    assert created.status_code == 201
    item = created.json()
    set_id = item["id"]
    west, south, east, north = tiles_bounds_deg(5, 26, 12, 27, 13)
    assert item == {
        "id": set_id,
        "name": "Daejeon",
        "status": "ready",
        "source_format": "mbtiles",
        "west_deg": pytest.approx(west),
        "south_deg": pytest.approx(south),
        "east_deg": pytest.approx(east),
        "north_deg": pytest.approx(north),
        "footprint": None,
        "min_zoom": 4,
        "max_zoom": 5,
        "tile_format": "png",
        "tile_count": 5,
        # An MBTiles file says nothing of its source: a pixel of its deepest level stands in.
        "gsd_m": pytest.approx(4891.97 * math.cos(math.radians((south + north) / 2)), rel=1e-3),
        "size_bytes": len(tiles_file),
        # Left empty in the request, so the file's own attribution is used.
        "attribution": "Tile maker",
        "license": "",
        "origin": None,
        "acquired_at": None,
        "created_at": item["created_at"],
        "sensor": None,
        "label": None,
        "sample": False,
        "updated_at": item["updated_at"],
        "stage": None,
        "progress": None,
        "error": None,
    }
    assert item["created_at"].endswith("Z")
    assert bare_client.get("/api/v1/imagery").json() == [item]
    assert sorted(p.name for p in (tmp_path / "imagery").glob("u*")) == [
        f"{set_id}.json",
        f"{set_id}.mbtiles",
    ]
    assert list((tmp_path / "imagery" / ".work").iterdir()) == []

    tile = bare_client.get(f"/api/v1/imagery/{set_id}/tiles/5/26/12")
    assert tile.status_code == 200
    assert tile.content == make_png()
    assert tile.headers["content-type"] == "image/png"
    assert "immutable" in tile.headers["cache-control"]

    # A tile the set does not have is transparent, not an error the globe would report.
    for address in ("5/0/0", "9/1/1", "5/99/0", "5/-1/0"):
        hole = bare_client.get(f"/api/v1/imagery/{set_id}/tiles/{address}")
        assert hole.status_code == 200, address
        assert hole.content == mbtiles.TRANSPARENT_TILE

    edited = bare_client.put(
        f"/api/v1/imagery/{set_id}",
        json={
            "name": "Renamed",
            "attribution": "Me",
            "license": " CC BY 4.0 ",
            "acquired_at": "2026-03-04T05:06:07+09:00",
        },
    )
    assert edited.status_code == 200
    assert edited.json()["name"] == "Renamed"
    assert edited.json()["attribution"] == "Me"
    assert edited.json()["license"] == "CC BY 4.0"
    # Leaving the licence out of a later edit keeps it.
    kept = bare_client.put(f"/api/v1/imagery/{set_id}", json={"name": "Renamed"})
    assert kept.json()["license"] == "CC BY 4.0"
    restored = {"name": "Renamed", "attribution": "Me", "acquired_at": "2026-03-04T05:06:07+09:00"}
    edited = bare_client.put(f"/api/v1/imagery/{set_id}", json=restored)
    assert edited.json()["acquired_at"] == "2026-03-03T20:06:07.000Z"
    assert edited.json()["max_zoom"] == 5

    assert bare_client.delete(f"/api/v1/imagery/{set_id}").status_code == 204
    assert bare_client.get("/api/v1/imagery").json() == []
    assert list((tmp_path / "imagery").glob("u*")) == []
    assert bare_client.delete(f"/api/v1/imagery/{set_id}").status_code == 404
    assert bare_client.get(f"/api/v1/imagery/{set_id}/tiles/5/26/12").status_code == 404


def test_the_sensor_is_kept_with_the_set(bare_client, tiles_file):
    radar = upload(bare_client, tiles_file, source_format="mbtiles", name="Radar", sensor="sar")
    assert radar.json()["sensor"] == "sar"
    set_id = radar.json()["id"]
    assert (
        upload(bare_client, tiles_file, source_format="mbtiles", name="?").json()["sensor"] is None
    )
    refused = upload(bare_client, tiles_file, source_format="mbtiles", name="x", sensor="lidar")
    assert refused.status_code == 422

    def edit(**changes) -> dict:
        return bare_client.put(
            f"/api/v1/imagery/{set_id}", json={"name": "Radar", **changes}
        ).json()

    # Left out of an edit it stays; an empty string clears it.
    assert edit()["sensor"] == "sar"
    assert edit(sensor="optical")["sensor"] == "optical"
    assert edit(sensor="")["sensor"] is None


@pytest.fixture
def sample_client(tmp_path, builtin_logos, make_mbtiles, make_png):
    """A server whose samples folder holds one optical and one radar set."""
    import httpx
    from fastapi.testclient import TestClient

    from soda.app import create_app
    from soda.settings import Settings

    samples = tmp_path / "samples" / "imagery"
    samples.mkdir(parents=True)
    for slug, sensor, name in (
        ("umbra-incheon-airport", "sar", "Incheon Airport"),
        ("maxar-wajima", "optical", "Wajima"),
    ):
        make_mbtiles(samples / f"{slug}.mbtiles", {(4, 13, 6): make_png()})
        sidecar = {
            "name": name,
            "label": {"ko": f"{name} (한국어)", "en": name},
            "source_format": "geotiff",
            "sensor": sensor,
            "west_deg": 112.5,
            "south_deg": 21.9,
            "east_deg": 135.0,
            "north_deg": 41.0,
            "footprint": None,
            "min_zoom": 4,
            "max_zoom": 4,
            "tile_format": "png",
            "tile_count": 1,
            "attribution": "Somebody",
            "license": "CC BY 4.0",
            "origin": None,
            "acquired_at": "2023-06-17T01:31:23.000Z",
            "created_at": "2026-10-01T00:00:00.000Z",
        }
        (samples / f"{slug}.json").write_text(json.dumps(sidecar), encoding="utf-8")
    settings = Settings(
        data_dir=tmp_path / "data",
        auto_refresh=False,
        builtin_logos_dir=builtin_logos,
        imagery_inbox=False,
        imagery_samples_dir=samples,
        source_path=tmp_path / "settings.local.toml",
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    with TestClient(create_app(settings, transport=transport, static=tmp_path / "none")) as client:
        yield client


def test_samples_are_listed_after_the_users_sets_and_locked(sample_client, tiles_file, make_png):
    client = sample_client
    assert client.get("/api/v1/imagery/samples").json() == {
        "enabled": True,
        "present": True,
        "count": 2,
    }
    mine = upload(client, tiles_file, source_format="mbtiles", name="Zzz mine").json()

    listed = client.get("/api/v1/imagery").json()
    # Optical samples come before radar ones, whatever their names.
    assert [item["id"] for item in listed] == [mine["id"], "maxar-wajima", "umbra-incheon-airport"]
    assert [item["sample"] for item in listed] == [False, True, True]
    radar = listed[2]
    assert (radar["sensor"], radar["license"]) == ("sar", "CC BY 4.0")
    assert radar["label"] == {"ko": "Incheon Airport (한국어)", "en": "Incheon Airport"}

    tile = client.get("/api/v1/imagery/umbra-incheon-airport/tiles/4/13/6")
    assert tile.status_code == 200 and tile.content == make_png()

    edited = client.put("/api/v1/imagery/maxar-wajima", json={"name": "Mine now"})
    removed = client.delete("/api/v1/imagery/maxar-wajima")
    for refused in (edited, removed):
        assert refused.status_code == 422
        assert refused.json()["detail"]["code"] == "imagerySampleLocked"
    assert len(client.get("/api/v1/imagery").json()) == 3


def test_samples_do_not_count_toward_the_set_limit(sample_client, tiles_file, monkeypatch):
    from soda.api import imagery as imagery_api

    monkeypatch.setattr(imagery_api, "MAX_IMAGERY_SETS", 1)
    assert upload(sample_client, tiles_file, source_format="mbtiles", name="One").status_code == 201
    full = upload(sample_client, tiles_file, source_format="mbtiles", name="Two")
    assert full.json()["detail"]["code"] == "imageryTooMany"


def test_without_a_samples_folder_nothing_is_listed(bare_client):
    assert bare_client.get("/api/v1/imagery/samples").json() == {
        "enabled": False,
        "present": False,
        "count": 0,
    }


def test_the_licence_given_at_upload_is_stored(bare_client, tiles_file):
    created = upload(
        bare_client, tiles_file, source_format="mbtiles", name="Noto", license="CC BY-NC 4.0"
    )
    assert created.status_code == 201
    assert created.json()["license"] == "CC BY-NC 4.0"
    too_long = upload(bare_client, tiles_file, source_format="mbtiles", name="x", license="L" * 61)
    assert too_long.json()["detail"]["code"] == "invalidRequest"


def test_unknown_and_malformed_ids_are_not_found(bare_client):
    for set_id in ("missing", "dotted.name", "UPPER"):
        response = bare_client.get(f"/api/v1/imagery/{set_id}/tiles/0/0/0")
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "imageryNotFound"
    edit = bare_client.put("/api/v1/imagery/missing", json={"name": "x"})
    assert edit.json()["detail"]["code"] == "imageryNotFound"


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"not sqlite", "imageryMbtilesInvalid"),
        (b"SQLite format 3\x00" + b"\x00" * 100, "imageryMbtilesInvalid"),
    ],
)
def test_a_bad_mbtiles_is_rejected_and_leaves_nothing(bare_client, tmp_path, content, code):
    response = upload(bare_client, content, source_format="mbtiles", name="bad")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert bare_client.get("/api/v1/imagery").json() == []
    assert [p for p in (tmp_path / "imagery").rglob("*") if p.is_file()] == []


def test_vector_tiles_are_rejected(bare_client, tmp_path, make_mbtiles):
    vector = make_mbtiles(tmp_path / "v.mbtiles", {(0, 0, 0): b"\x1f\x8b vector"}).read_bytes()
    response = upload(bare_client, vector, source_format="mbtiles", name="vector")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "imageryMbtilesNotRaster"


def test_request_fields_are_validated(bare_client, tiles_file):
    missing_name = upload(bare_client, tiles_file, source_format="mbtiles")
    assert missing_name.status_code == 422
    assert missing_name.json()["detail"]["code"] == "invalidRequest"
    bad_format = upload(bare_client, tiles_file, source_format="shapefile", name="x")
    assert bad_format.json()["detail"]["code"] == "invalidRequest"
    long_name = upload(bare_client, tiles_file, source_format="mbtiles", name="x" * 61)
    assert long_name.json()["detail"]["code"] == "invalidRequest"


def test_upload_size_limit(bare_client, tmp_path, tiles_file, monkeypatch):
    monkeypatch.setattr("soda.api.imagery.MAX_IMAGERY_BYTES", len(tiles_file) - 1)
    response = upload(bare_client, tiles_file, source_format="mbtiles", name="big")
    assert response.status_code == 413
    detail = response.json()["detail"]
    assert detail["code"] == "imageryTooLarge"
    assert detail["params"] == {"max_mb": 0}
    assert [p for p in (tmp_path / "imagery").rglob("*") if p.is_file()] == []
    assert MAX_IMAGERY_BYTES == 1024**3


def test_set_count_limit(bare_client, tiles_file, monkeypatch):
    monkeypatch.setattr("soda.api.imagery.MAX_IMAGERY_SETS", 1)
    assert upload(bare_client, tiles_file, source_format="mbtiles", name="one").status_code == 201
    response = upload(bare_client, tiles_file, source_format="mbtiles", name="two")
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "imageryTooMany",
        "message": response.json()["detail"]["message"],
        "params": {"max": 1},
    }
    assert MAX_IMAGERY_SETS == 200


def test_image_needs_valid_corners_before_the_body_is_kept(bare_client, tmp_path, make_png):
    for corners in (None, "1,2,3", "0,0,1,0,2,0,1,-1"):
        params = {"source_format": "image", "name": "quicklook"}
        if corners is not None:
            params["corners_deg"] = corners
        response = upload(bare_client, make_png(), **params)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "imageryCornersInvalid"
    assert not (tmp_path / "imagery").exists()


def test_wrong_file_for_the_format_is_rejected_at_once(bare_client, make_png):
    not_image = upload(
        bare_client, b"plain text", source_format="image", name="x", corners_deg=QUAD
    )
    assert not_image.status_code == 422
    assert not_image.json()["detail"]["code"] == "imageryImageUnreadable"
    not_tiff = upload(bare_client, make_png(), source_format="geotiff", name="x")
    assert not_tiff.status_code == 422
    assert not_tiff.json()["detail"]["code"] == "imageryGeotiffUnreadable"
    assert bare_client.get("/api/v1/imagery").json() == []


def test_image_import_runs_as_a_job(bare_client, tmp_path, make_png):
    response = upload(
        bare_client,
        make_png(64, 64),
        source_format="image",
        name="Quicklook",
        attribution="Somebody",
        acquired_at="2010-10-09T02:38:31Z",
        corners_deg=QUAD,
    )
    assert response.status_code == 202
    job = response.json()
    assert job["status"] == "processing"
    assert job["name"] == "Quicklook"
    assert job["west_deg"] is None and job["max_zoom"] is None and job["error"] is None

    item = wait_until_settled(bare_client, job["id"])
    assert item["status"] == "ready"
    assert item["source_format"] == "image"
    assert item["attribution"] == "Somebody"
    assert item["acquired_at"] == "2010-10-09T02:38:31.000Z"
    assert item["created_at"] == job["created_at"]
    assert item["footprint"] == [float(value) for value in QUAD.split(",")]
    assert (item["west_deg"], item["north_deg"]) == pytest.approx((126.0, 37.75))
    assert item["tile_count"] > 0
    # The scratch directory is gone and only the finished set remains.
    assert sorted(p.name for p in (tmp_path / "imagery").iterdir()) == [
        ".work",
        f"{item['id']}.json",
        f"{item['id']}.mbtiles",
    ]
    assert list((tmp_path / "imagery" / ".work").iterdir()) == []
    top = bare_client.get(f"/api/v1/imagery/{item['id']}/tiles/{item['min_zoom']}/218/99")
    assert top.status_code == 200


def test_a_failed_import_is_listed_until_dismissed(bare_client, tmp_path):
    # A PNG signature gets past the upload check; decoding then fails inside the job.
    broken = b"\x89PNG\r\n\x1a\n" + b"junk" * 64
    response = upload(bare_client, broken, source_format="image", name="Broken", corners_deg=QUAD)
    assert response.status_code == 202
    set_id = response.json()["id"]

    failed = wait_until_settled(bare_client, set_id)
    assert failed["status"] == "failed"
    assert failed["error"]["code"] == "imageryImageUnreadable"
    assert failed["progress"] is None
    assert list((tmp_path / "imagery").glob("u*")) == []

    assert bare_client.delete(f"/api/v1/imagery/{set_id}").status_code == 204
    assert bare_client.get("/api/v1/imagery").json() == []


def test_startup_sweeps_interrupted_imports(tmp_path, builtin_logos):
    import httpx
    from fastapi.testclient import TestClient

    from soda.app import create_app
    from soda.settings import Settings

    imagery = tmp_path / "imagery"
    (imagery / ".work" / "u1").mkdir(parents=True)
    (imagery / ".work" / "u1" / "source").write_bytes(b"partial upload")
    (imagery / "u2.mbtiles").write_bytes(b"tiles without a sidecar")
    settings = Settings(
        data_dir=tmp_path,
        auto_refresh=False,
        builtin_logos_dir=builtin_logos,
        imagery_inbox=False,
        source_path=tmp_path / "settings.local.toml",
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    with TestClient(create_app(settings, transport=transport, static=tmp_path / "none")) as client:
        assert client.get("/api/v1/imagery").json() == []
    assert list(imagery.iterdir()) == []


def test_the_server_starts_without_loading_rasterio():
    """GDAL is only needed to warp, so importing the app must not pay for it."""
    script = "import sys, soda.app; print('rasterio' in sys.modules)"
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "False"


def test_the_import_queue_is_bounded(bare_client, tiles_file, make_png, monkeypatch):
    monkeypatch.setattr("soda.api.imagery.MAX_IMPORT_QUEUE", 0)
    refused = upload(
        bare_client, make_png(), source_format="image", name="quicklook", corners_deg=QUAD
    )
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "imageryQueueFull"
    assert refused.json()["detail"]["params"] == {"max": 0}
    # An MBTiles is registered on the spot and never waits in the queue.
    assert upload(bare_client, tiles_file, source_format="mbtiles", name="tiles").status_code == 201


def test_a_running_import_reports_its_stage(bare_client, make_png):
    response = upload(
        bare_client, make_png(64, 64), source_format="image", name="Quicklook", corners_deg=QUAD
    )
    assert response.json()["stage"] in {"queued", "tiling"}
    item = wait_until_settled(bare_client, response.json()["id"])
    assert item["status"] == "ready" and item["stage"] is None
