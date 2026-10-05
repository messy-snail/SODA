"""The watched folder. Scans are driven by hand with an injected clock; no timers run."""

import json
import os
import time
import warnings
import zipfile

import numpy as np
import pytest
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.transform import from_origin

from soda.imagery import inbox as inbox_module
from soda.imagery import products as products_module
from soda.imagery.inbox import InboxWatcher, read_sidecar
from soda.imagery.jobs import ImageryHub
from soda.imagery.library import ImageryLibrary

QUAD = [126.0, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95]


@pytest.fixture
def hub(tmp_path):
    hub = ImageryHub(ImageryLibrary(tmp_path / "imagery"))
    yield hub
    hub.shutdown()


@pytest.fixture
def watcher(hub, tmp_path):
    """A watcher whose clock is far enough ahead that any file counts as old."""
    watcher = InboxWatcher(hub, tmp_path / "imagery" / "inbox", clock=lambda: time.time() + 3600)
    watcher.recover()
    return watcher


def write_geotiff(path) -> None:
    data = np.full((3, 32, 32), 150, np.uint8)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=32,
        height=32,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_origin(127.0, 37.0, 0.002, 0.002),
    ) as target:
        target.write(data)


def settle(watcher: InboxWatcher, hub: ImageryHub, timeout_s: float = 20.0) -> None:
    """Scan twice (a file is only taken once it is seen unchanged) and wait for the imports."""
    watcher.scan_once()
    watcher.scan_once()
    deadline = time.monotonic() + timeout_s
    while hub.pending_count() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert hub.pending_count() == 0


def names(directory) -> list[str]:
    return sorted(p.name for p in directory.iterdir()) if directory.is_dir() else []


def test_recover_creates_the_folder(watcher):
    assert watcher.root.is_dir()
    assert watcher.waiting == []


def test_a_file_is_left_alone_until_it_stops_changing(hub, tmp_path):
    now = [0.0]
    watcher = InboxWatcher(hub, tmp_path / "imagery" / "inbox", clock=lambda: now[0])
    watcher.recover()
    path = watcher.root / "scene.tif"
    write_geotiff(path)
    now[0] = path.stat().st_mtime + 1

    watcher.scan_once()
    assert watcher.waiting == [{"file": "scene.tif", "reason": "settling"}]
    # Seen twice unchanged, but written a second ago: a copy may still be going.
    watcher.scan_once()
    assert watcher.waiting == [{"file": "scene.tif", "reason": "settling"}]

    now[0] += 60
    with path.open("ab") as handle:
        handle.write(b"\0")
    os.utime(path, (now[0] - 30, now[0] - 30))
    # Old enough now, but it changed since the last look.
    watcher.scan_once()
    assert watcher.waiting == [{"file": "scene.tif", "reason": "settling"}]
    assert path.is_file() and hub.jobs() == []

    watcher.scan_once()
    assert watcher.waiting == []
    assert not path.exists()


def test_a_geotiff_becomes_a_set_and_moves_to_done(watcher, hub):
    write_geotiff(watcher.root / "Daejeon 2024.tif")
    settle(watcher, hub)

    (item,) = hub.library.entries()
    assert (item.name, item.source_format) == ("Daejeon 2024", "geotiff")
    assert (item.west_deg, item.north_deg) == pytest.approx((127.0, 37.0), abs=1e-6)
    assert names(watcher.root / "done") == ["Daejeon 2024.tif"]
    assert names(watcher.root) == [".processing", "done"]
    assert names(watcher.root / ".processing") == []
    assert hub.jobs() == []


def test_a_broken_file_is_listed_as_failed_and_kept(watcher, hub):
    (watcher.root / "broken.tif").write_bytes(b"II*\x00" + b"\xff" * 64)
    settle(watcher, hub)

    assert hub.library.entries() == []
    (job,) = hub.jobs()
    assert job.status == "failed"
    assert job.error["code"] == "imageryGeotiffUnreadable"
    assert job.meta["name"] == "broken"
    assert names(watcher.root / "failed") == ["broken.tif"]
    # It is not picked up again from where it was put.
    settle(watcher, hub)
    assert len(hub.jobs()) == 1


def test_an_image_waits_for_its_corners(watcher, hub, make_png):
    (watcher.root / "quicklook.png").write_bytes(make_png(32, 32))
    settle(watcher, hub)
    assert watcher.waiting == [{"file": "quicklook.png", "reason": "needsCorners"}]
    assert hub.library.entries() == []

    sidecar = {
        "corners_deg": QUAD,
        "name": "Quicklook over Incheon",
        "attribution": "Somebody",
        "license": "CC BY 4.0",
        "acquired_at": "2010-10-09T11:38:31+09:00",
        "sensor": "sar",
    }
    (watcher.root / "quicklook.json").write_text(json.dumps(sidecar))
    settle(watcher, hub)

    (item,) = hub.library.entries()
    assert item.name == "Quicklook over Incheon"
    assert item.sensor == "sar"
    assert (item.attribution, item.license) == ("Somebody", "CC BY 4.0")
    assert item.acquired_at == "2010-10-09T02:38:31.000Z"
    assert item.footprint == tuple(QUAD)
    assert names(watcher.root / "done") == ["quicklook.json", "quicklook.png"]


@pytest.mark.parametrize(
    "sidecar",
    [
        "not json",
        "[1, 2, 3]",
        json.dumps({"corners_deg": [1, 2, 3]}),
        json.dumps({"corners_deg": "126,37"}),
        json.dumps({"corners_deg": QUAD, "name": "x" * 61}),
        json.dumps({"corners_deg": QUAD, "acquired_at": "yesterday"}),
        json.dumps({"corners_deg": QUAD, "sensor": "lidar"}),
        json.dumps({"name": "no corners"}),
    ],
)
def test_a_bad_sidecar_fails_the_image(watcher, hub, make_png, sidecar):
    (watcher.root / "quicklook.png").write_bytes(make_png(8, 8))
    (watcher.root / "quicklook.json").write_text(sidecar)
    settle(watcher, hub)

    (job,) = hub.jobs()
    assert job.status == "failed" and job.error["code"] == "imagerySidecarInvalid"
    assert names(watcher.root / "failed") == ["quicklook.json", "quicklook.png"]
    assert hub.library.entries() == []


def test_read_sidecar_keeps_only_known_fields(tmp_path):
    path = tmp_path / "s.json"
    path.write_text(json.dumps({"name": " A ", "license": None, "other": 1, "corners_deg": QUAD}))
    assert read_sidecar(path) == {"name": "A", "corners_deg": tuple(float(v) for v in QUAD)}


def test_an_mbtiles_is_registered_as_it_is(watcher, hub, make_mbtiles, make_png):
    make_mbtiles(watcher.root / "city.mbtiles", {(4, 13, 6): make_png()}, attribution="Tile maker")
    settle(watcher, hub)

    (item,) = hub.library.entries()
    assert (item.name, item.source_format, item.tile_count) == ("city", "mbtiles", 1)
    assert item.attribution == "Tile maker"
    assert names(watcher.root / "done") == ["city.mbtiles"]


def test_an_mbtiles_still_being_written_waits(watcher, hub, make_mbtiles, make_png):
    make_mbtiles(watcher.root / "city.mbtiles", {(4, 13, 6): make_png()})
    (watcher.root / "city.mbtiles-journal").write_bytes(b"")
    settle(watcher, hub)
    assert watcher.waiting == [{"file": "city.mbtiles", "reason": "settling"}]
    assert hub.library.entries() == []


def test_files_wait_while_the_library_is_full(watcher, hub, monkeypatch):
    monkeypatch.setattr(inbox_module, "MAX_IMAGERY_SETS", 0)
    write_geotiff(watcher.root / "scene.tif")
    settle(watcher, hub)
    assert watcher.waiting == [{"file": "scene.tif", "reason": "full"}]
    assert names(watcher.root) == [".processing", "scene.tif"] or names(watcher.root) == [
        "scene.tif"
    ]

    monkeypatch.setattr(inbox_module, "MAX_IMAGERY_SETS", 200)
    settle(watcher, hub)
    assert len(hub.library.entries()) == 1


def test_an_oversized_file_fails(watcher, hub, monkeypatch):
    monkeypatch.setattr(inbox_module, "MAX_INBOX_BYTES", 10)
    write_geotiff(watcher.root / "huge.tif")
    settle(watcher, hub)
    (job,) = hub.jobs()
    assert job.error["code"] == "imageryTooLarge"
    assert names(watcher.root / "failed") == ["huge.tif"]


def test_only_plain_files_with_known_extensions_are_looked_at(watcher, hub, tmp_path):
    outside = tmp_path / "outside.tif"
    write_geotiff(outside)
    (watcher.root / "link.tif").symlink_to(outside)
    (watcher.root / ".hidden.tif").write_bytes(outside.read_bytes())
    (watcher.root / "notes.txt").write_text("hello")
    (watcher.root / "folder.tif").mkdir()
    settle(watcher, hub)

    assert watcher.waiting == []
    assert hub.library.entries() == [] and hub.jobs() == []
    assert outside.is_file() and (watcher.root / "notes.txt").is_file()


def test_a_second_file_with_the_same_name_gets_a_suffix(watcher, hub):
    write_geotiff(watcher.root / "scene.tif")
    settle(watcher, hub)
    write_geotiff(watcher.root / "scene.tif")
    settle(watcher, hub)

    assert names(watcher.root / "done") == ["scene-1.tif", "scene.tif"]
    assert len(hub.library.entries()) == 2


def test_a_restart_puts_claimed_files_back(hub, tmp_path):
    root = tmp_path / "imagery" / "inbox"
    claimed = root / ".processing" / "u123abc"
    claimed.mkdir(parents=True)
    write_geotiff(claimed / "scene.tif")
    (claimed / "georeferenced.tif").write_bytes(b"scratch")
    watcher = InboxWatcher(hub, root, clock=lambda: time.time() + 3600)

    watcher.recover()

    assert names(root) == [".processing", "scene.tif"]
    assert names(root / ".processing") == []
    settle(watcher, hub)
    assert len(hub.library.entries()) == 1


def write_scene_tif(path) -> None:
    """A scene image: raw counts and no georeferencing of its own."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(
            path, "w", driver="GTiff", width=64, height=64, count=1, dtype="uint8"
        ) as target:
            target.write(np.tile(np.linspace(40, 130, 64, dtype=np.uint8), (64, 1))[None])


def write_scene_zip(path, tmp_path, dim: bytes, extra: dict[str, bytes] | None = None) -> None:
    """A product archive laid out the way CNES delivers a SPOT scene."""
    write_scene_tif(tmp_path / "scene-source.tif")
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr("VOL_LIST.DIM", "<Dimap_Document/>")
        bundle.writestr("SCENE01/METADATA.DIM", dim)
        bundle.write(tmp_path / "scene-source.tif", "SCENE01/IMAGERY.TIF")
        bundle.writestr("SCENE01/PREVIEW.JPG", b"\xff\xd8\xff")
        for name, data in (extra or {}).items():
            bundle.writestr(name, data)


def test_a_scene_archive_becomes_a_set_and_moves_to_done(watcher, hub, tmp_path, make_dim):
    write_scene_zip(watcher.root / "002-005_S5_303-275-0.zip", tmp_path, make_dim())
    settle(watcher, hub)

    assert hub.jobs() == []
    (item,) = hub.library.entries()
    assert (item.name, item.source_format) == ("SPOT 5 HRG1 A 2006-05-07", "scene")
    # A SPOT scene is a photograph, whatever the sidecar leaves unsaid.
    assert item.sensor == "optical"
    assert item.footprint == tuple(QUAD)
    assert (item.attribution, item.license) == ("© CNES 2006", "")
    assert item.acquired_at == "2006-05-07T02:22:12.000Z"
    assert names(watcher.root / "done") == ["002-005_S5_303-275-0.zip"]
    assert names(watcher.root / ".processing") == []


def test_a_scene_folder_is_taken_whole(watcher, hub, make_dim):
    product = watcher.root / "S5_303-275-0_2006-05-07.KK"
    write_scene_tif(product / "SCENE01" / "IMAGERY.TIF")
    (product / "SCENE01" / "METADATA.DIM").write_bytes(make_dim())
    (product / "VOL_LIST.DIM").write_text("<Dimap_Document/>")
    # The folder's whole name is the stem, dots included.
    sidecar = {"name": "Incheon 5 m", "license": "Open Licence 2.0 (Etalab)"}
    (watcher.root / "S5_303-275-0_2006-05-07.KK.json").write_text(json.dumps(sidecar))
    settle(watcher, hub)

    (item,) = hub.library.entries()
    assert (item.name, item.license, item.source_format) == (
        "Incheon 5 m",
        "Open Licence 2.0 (Etalab)",
        "scene",
    )
    assert item.attribution == "© CNES 2006"
    assert names(watcher.root / "done") == [
        "S5_303-275-0_2006-05-07.KK",
        "S5_303-275-0_2006-05-07.KK.json",
    ]
    kept = watcher.root / "done" / "S5_303-275-0_2006-05-07.KK" / "SCENE01"
    assert names(kept) == ["IMAGERY.TIF", "METADATA.DIM"]


def test_a_folder_is_left_alone_until_it_stops_changing(hub, tmp_path, make_dim):
    now = [0.0]
    watcher = InboxWatcher(hub, tmp_path / "imagery" / "inbox", clock=lambda: now[0])
    watcher.recover()
    product = watcher.root / "product"
    (product / "SCENE01").mkdir(parents=True)
    (product / "SCENE01" / "METADATA.DIM").write_bytes(make_dim())
    now[0] = time.time() + 60
    watcher.scan_once()
    assert watcher.waiting == [{"file": "product", "reason": "settling"}]

    # The image arrives after the metadata: the folder changed, so it waits one more scan.
    write_scene_tif(product / "SCENE01" / "IMAGERY.TIF")
    now[0] = time.time() + 60
    watcher.scan_once()
    assert watcher.waiting == [{"file": "product", "reason": "settling"}]
    assert product.is_dir() and hub.jobs() == []

    settle(watcher, hub)
    assert not product.exists()
    assert len(hub.library.entries()) == 1


def test_a_folder_missing_its_image_fails_and_is_kept(watcher, hub, make_dim):
    product = watcher.root / "product"
    (product / "SCENE01").mkdir(parents=True)
    (product / "SCENE01" / "METADATA.DIM").write_bytes(make_dim())
    settle(watcher, hub)

    (job,) = hub.jobs()
    assert job.error["code"] == "imageryProductInvalid"
    assert names(watcher.root / "failed") == ["product"]
    assert names(watcher.root / "failed" / "product" / "SCENE01") == ["METADATA.DIM"]


def test_folders_without_a_scene_are_not_touched(watcher, hub):
    (watcher.root / "notes").mkdir()
    (watcher.root / "notes" / "readme.txt").write_text("hello")
    (watcher.root / "done").mkdir()
    (watcher.root / "done" / "METADATA.DIM").write_text("left from before")
    settle(watcher, hub)
    assert watcher.waiting == [] and hub.jobs() == []
    assert names(watcher.root / "notes") == ["readme.txt"]


@pytest.mark.parametrize(
    "build",
    [
        # No scene in it at all.
        lambda path, tmp, dim: zipfile.ZipFile(path, "w").writestr("readme.txt", "hello"),
        lambda path, tmp, dim: path.write_bytes(b"PK\x03\x04 not really a zip"),
        # Two scenes: which one is meant cannot be told.
        lambda path, tmp, dim: write_scene_zip(path, tmp, dim(), {"SCENE02/METADATA.DIM": dim()}),
        # The metadata names a file the archive does not hold beside it.
        lambda path, tmp, dim: write_scene_zip(path, tmp, dim(href="OTHER.TIF")),
        lambda path, tmp, dim: write_scene_zip(path, tmp, dim(href="../IMAGERY.TIF")),
        lambda path, tmp, dim: write_scene_zip(path, tmp, dim(order=(0, 1, 2))),
    ],
)
def test_a_bad_archive_fails_and_is_kept(watcher, hub, tmp_path, make_dim, build):
    build(watcher.root / "product.zip", tmp_path, make_dim)
    settle(watcher, hub)

    (job,) = hub.jobs()
    assert job.status == "failed" and job.error["code"] == "imageryProductInvalid"
    assert hub.library.entries() == []
    assert names(watcher.root / "failed") == ["product.zip"]
    assert names(watcher.root / ".processing") == []


def test_an_archive_never_writes_under_its_own_names(watcher, hub, tmp_path, make_dim):
    """Member names pick what is read; nothing is written where they point."""
    escape = "../../../escaped.txt"
    write_scene_zip(watcher.root / "product.zip", tmp_path, make_dim(), {escape: b"out"})
    settle(watcher, hub)

    assert len(hub.library.entries()) == 1
    assert not list(tmp_path.rglob("escaped.txt"))
    assert names(watcher.root / ".processing") == []


def test_an_oversized_scene_image_fails(watcher, hub, tmp_path, make_dim, monkeypatch):
    write_scene_zip(watcher.root / "product.zip", tmp_path, make_dim())
    monkeypatch.setattr(products_module, "MAX_INBOX_BYTES", 100)
    settle(watcher, hub)
    (job,) = hub.jobs()
    assert job.error["code"] == "imageryTooLarge"
    assert names(watcher.root / "failed") == ["product.zip"]


def test_a_restart_does_not_hand_back_an_extracted_image(hub, tmp_path, make_dim):
    root = tmp_path / "imagery" / "inbox"
    claimed = root / ".processing" / "u123abc"
    claimed.mkdir(parents=True)
    write_scene_zip(claimed / "product.zip", tmp_path, make_dim())
    (claimed / "extracted.tif").write_bytes(b"scratch")
    watcher = InboxWatcher(hub, root, clock=lambda: time.time() + 3600)

    watcher.recover()

    assert names(root) == [".processing", "product.zip"]


def test_the_api_reports_the_inbox(tmp_path, builtin_logos, bare_client):
    import httpx
    from fastapi.testclient import TestClient

    from soda.app import create_app
    from soda.settings import Settings

    # Off in the shared fixture, so other tests see only their own files.
    assert bare_client.get("/api/v1/imagery/inbox").json() == {
        "enabled": False,
        "path": None,
        "waiting": [],
    }

    data = tmp_path / "with-inbox"
    settings = Settings(
        data_dir=data,
        auto_refresh=False,
        builtin_logos_dir=builtin_logos,
        source_path=tmp_path / "settings.local.toml",
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    with TestClient(create_app(settings, transport=transport, static=tmp_path / "none")) as client:
        body = client.get("/api/v1/imagery/inbox").json()
        assert body["enabled"] is True
        assert body["path"] == str((data / "imagery" / "inbox").resolve())
        assert body["waiting"] == []
    assert (data / "imagery" / "inbox").is_dir()
