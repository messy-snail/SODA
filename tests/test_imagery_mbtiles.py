import gzip
import json
import sqlite3
from contextlib import closing

import pytest

from soda.imagery import mbtiles
from soda.imagery.formats import ImageryError
from soda.imagery.library import ImageryLibrary, is_valid_id
from soda.imagery.limits import MAX_MBTILES_ZOOM
from soda.imagery.tiling import tiles_bounds_deg


def test_transparent_tile_is_a_png():
    assert mbtiles.tile_media_type(mbtiles.TRANSPARENT_TILE) == "image/png"
    assert mbtiles.TRANSPARENT_TILE[16:24] == (256).to_bytes(4) * 2


def test_inspect_describes_the_tiles(tmp_path, make_mbtiles, make_png):
    png = make_png()
    path = make_mbtiles(
        tmp_path / "set.mbtiles",
        {(4, 13, 6): png, (5, 26, 12): png, (5, 27, 13): png},
        attribution="  Somebody  ",
    )
    info = mbtiles.inspect(path)
    assert (info.min_zoom, info.max_zoom, info.tile_count) == (4, 5, 3)
    assert info.tile_format == "png"
    assert info.attribution == "Somebody"
    assert info.bounds_deg == pytest.approx(tiles_bounds_deg(5, 26, 12, 27, 13))


def test_declared_bounds_are_used_only_inside_the_tiles(tmp_path, make_mbtiles, make_png):
    tiles = {(5, 26, 12): make_png()}
    extent = tiles_bounds_deg(5, 26, 12, 26, 12)
    inside = (extent[0] + 1, extent[1] + 1, extent[2] - 1, extent[3] - 1)
    tight = make_mbtiles(
        tmp_path / "tight.mbtiles", tiles, bounds=",".join(str(value) for value in inside)
    )
    assert mbtiles.inspect(tight).bounds_deg == pytest.approx(inside)
    lying = make_mbtiles(tmp_path / "lying.mbtiles", tiles, bounds="-180,-85,180,85")
    assert mbtiles.inspect(lying).bounds_deg == pytest.approx(extent)
    garbage = make_mbtiles(tmp_path / "garbage.mbtiles", tiles, bounds="here")
    assert mbtiles.inspect(garbage).bounds_deg == pytest.approx(extent)


def test_read_tile_flips_the_row(tmp_path, make_mbtiles, make_png):
    north, south = make_png(2, 1), make_png(1, 2)
    path = make_mbtiles(tmp_path / "set.mbtiles", {(1, 0, 0): north, (1, 0, 1): south})
    assert mbtiles.read_tile(path, 1, 0, 0) == north
    assert mbtiles.read_tile(path, 1, 0, 1) == south
    assert mbtiles.read_tile(path, 1, 1, 1) is None
    with closing(sqlite3.connect(path)) as db:
        stored = db.execute("SELECT tile_row FROM tiles WHERE tile_data = ?", (north,)).fetchone()
    assert stored == (1,)
    assert mbtiles.tms_row(1, mbtiles.tms_row(1, 0)) == 0


def test_writer_output_passes_inspection(tmp_path, make_png):
    path = tmp_path / "written.mbtiles"
    writer = mbtiles.MbtilesWriter(path)
    writer.add(3, 2, 1, make_png())
    writer.finish({"format": "png"})
    info = mbtiles.inspect(path)
    assert (info.min_zoom, info.max_zoom, info.tile_count) == (3, 3, 1)
    assert mbtiles.read_tile(path, 3, 2, 1) == make_png()


def _no_tiles_table(path):
    with closing(sqlite3.connect(path)) as db:
        db.execute("CREATE TABLE other (value TEXT)")
        db.commit()


def _empty_tiles(path):
    with closing(sqlite3.connect(path)) as db:
        db.execute("CREATE TABLE tiles (zoom_level, tile_column, tile_row, tile_data)")
        db.commit()


def _too_deep(path):
    with closing(sqlite3.connect(path)) as db:
        db.execute("CREATE TABLE tiles (zoom_level, tile_column, tile_row, tile_data)")
        db.execute(
            "INSERT INTO tiles VALUES (?, 0, 0, x'89504e470d0a1a0a')", (MAX_MBTILES_ZOOM + 1,)
        )
        db.commit()


def _column_out_of_range(path):
    with closing(sqlite3.connect(path)) as db:
        db.execute("CREATE TABLE tiles (zoom_level, tile_column, tile_row, tile_data)")
        db.execute("INSERT INTO tiles VALUES (2, 9, 0, x'89504e470d0a1a0a')")
        db.commit()


def _text_zoom(path):
    with closing(sqlite3.connect(path)) as db:
        db.execute("CREATE TABLE tiles (zoom_level, tile_column, tile_row, tile_data)")
        db.execute("INSERT INTO tiles VALUES ('deep', 0, 0, x'89504e470d0a1a0a')")
        db.commit()


@pytest.mark.parametrize(
    "build",
    [
        lambda path: path.write_bytes(b"not a database at all"),
        lambda path: path.write_bytes(b"SQLite format 3\x00" + b"\x00" * 200),
        _no_tiles_table,
        _empty_tiles,
        _too_deep,
        _column_out_of_range,
        _text_zoom,
    ],
)
def test_inspect_rejects_files_that_are_not_mbtiles(tmp_path, build):
    path = tmp_path / "bad.mbtiles"
    build(path)
    with pytest.raises(ImageryError) as caught:
        mbtiles.inspect(path)
    assert caught.value.code == "imageryMbtilesInvalid"


@pytest.mark.parametrize("tile", [gzip.compress(b"vector tile"), b"plain text", ""])
def test_inspect_rejects_tiles_that_are_not_images(tmp_path, make_mbtiles, tile):
    path = make_mbtiles(tmp_path / "vector.mbtiles", {(0, 0, 0): tile})
    with pytest.raises(ImageryError) as caught:
        mbtiles.inspect(path)
    assert caught.value.code == "imageryMbtilesNotRaster"


def test_readonly_connection_refuses_everything_but_reads(tmp_path, make_mbtiles, make_png):
    path = make_mbtiles(tmp_path / "set.mbtiles", {(0, 0, 0): make_png()})
    with closing(mbtiles.open_readonly(path)) as db:
        assert db.execute("SELECT COUNT(*) FROM tiles").fetchone() == (1,)
        for statement in (
            "DELETE FROM tiles",
            "CREATE TABLE extra (value)",
            "ATTACH DATABASE ':memory:' AS other",
            "PRAGMA query_only=OFF",
        ):
            with pytest.raises(sqlite3.Error):
                db.execute(statement)


def test_a_view_named_tiles_is_read_like_a_table(tmp_path, make_png):
    """Many MBTiles writers store tiles deduplicated behind a ``tiles`` view."""
    path = tmp_path / "view.mbtiles"
    with closing(sqlite3.connect(path)) as db:
        db.executescript(
            "CREATE TABLE map (zoom_level, tile_column, tile_row, tile_id);"
            "CREATE TABLE images (tile_id, tile_data);"
            "CREATE VIEW tiles AS SELECT zoom_level, tile_column, tile_row, tile_data"
            " FROM map JOIN images ON map.tile_id = images.tile_id;"
        )
        db.execute("INSERT INTO images VALUES ('a', ?)", (make_png(),))
        db.execute("INSERT INTO map VALUES (1, 1, 0, 'a')")
        db.commit()
    assert mbtiles.inspect(path).tile_count == 1
    assert mbtiles.read_tile(path, 1, 1, 1) == make_png()


def _meta(name: str, created_at: str = "2026-01-01T00:00:00.000Z") -> dict:
    return {
        "name": name,
        "source_format": "mbtiles",
        "west_deg": 1.0,
        "south_deg": 2.0,
        "east_deg": 3.0,
        "north_deg": 4.0,
        "footprint": None,
        "min_zoom": 0,
        "max_zoom": 0,
        "tile_format": "png",
        "tile_count": 1,
        "attribution": "",
        "acquired_at": None,
        "created_at": created_at,
    }


@pytest.mark.parametrize("set_id", ["", "../x", "A", "a/b", "a.b", "-a", "a" * 65])
def test_ids_that_could_escape_the_directory_are_invalid(set_id):
    assert not is_valid_id(set_id)


def test_library_lists_edits_and_deletes(tmp_path, make_mbtiles, make_png):
    tiles = {(0, 0, 0): make_png()}
    library = ImageryLibrary(tmp_path / "data")
    library.add("u1", make_mbtiles(tmp_path / "1", tiles), _meta("old", "2026-01-01T00:00:00.000Z"))
    library.add("u2", make_mbtiles(tmp_path / "2", tiles), _meta("new", "2026-02-01T00:00:00.000Z"))

    listed = library.entries()
    assert [item.id for item in listed] == ["u2", "u1"]
    assert library.count() == 2
    assert library.get("../data/u1") is None
    # A sidecar written before licences existed still reads.
    assert (listed[0].license, listed[0].origin) == ("", None)

    renamed = library.update("u1", name="renamed", license="CC BY 4.0", origin="oam:abc")
    assert renamed is not None and renamed.name == "renamed" and renamed.west_deg == 1.0
    assert (renamed.license, renamed.origin) == ("CC BY 4.0", "oam:abc")
    assert library.update("missing", name="x") is None

    assert library.delete("missing") is False
    assert library.delete("u1") is True
    assert library.get("u1") is None
    assert sorted(p.name for p in (tmp_path / "data").iterdir()) == ["u2.json", "u2.mbtiles"]


def test_sweep_removes_what_an_interrupted_import_left(tmp_path, make_mbtiles, make_png):
    library = ImageryLibrary(tmp_path / "data")
    library.add("u1", make_mbtiles(tmp_path / "1", {(0, 0, 0): make_png()}), _meta("kept"))
    work = library.work_dir("u9")
    work.mkdir(parents=True)
    (work / "source").write_bytes(b"partial")
    (tmp_path / "data" / "u8.mbtiles").write_bytes(b"orphan tiles")
    (tmp_path / "data" / "u7.json").write_text("{}")

    library.sweep()

    assert sorted(p.name for p in (tmp_path / "data").iterdir()) == ["u1.json", "u1.mbtiles"]
    assert library.new_id() not in {"u1"}
    with pytest.raises(ValueError):
        library.work_dir("../escape")


def test_samples_are_read_from_a_second_folder(tmp_path, make_mbtiles, make_png):
    samples = tmp_path / "samples"
    samples.mkdir()
    for slug, name in (("b-sample", "Beta"), ("a-sample", "Alpha"), ("shared", "Sample copy")):
        make_mbtiles(samples / f"{slug}.mbtiles", {(0, 0, 0): make_png()})
        meta = {**_meta(name), "sensor": "sar", "label": {"ko": "이름", "en": name}}
        (samples / f"{slug}.json").write_text(json.dumps(meta), encoding="utf-8")
    library = ImageryLibrary(tmp_path / "imagery", samples)
    library.add(
        "shared", make_mbtiles(tmp_path / "t.mbtiles", {(0, 0, 0): make_png()}), _meta("Own")
    )

    assert [(item.name, item.sample) for item in library.entries()] == [
        ("Own", False),
        ("Alpha", True),
        ("Beta", True),
    ]
    # A user's set stands in front of the sample of the same id.
    assert library.get("shared").name == "Own"
    assert library.get("a-sample").sample is True
    assert (library.get("a-sample").sensor, library.get("a-sample").label["en"]) == ("sar", "Alpha")
    assert library.count() == 1

    # Nothing the library does writes to the samples folder.
    before = sorted(p.name for p in samples.iterdir())
    library.sweep()
    assert library.delete("a-sample") is False
    assert library.update("a-sample", name="x") is None
    assert sorted(p.name for p in samples.iterdir()) == before

    assert ImageryLibrary(tmp_path / "imagery").get("a-sample") is None


def test_old_sidecars_and_odd_values_read_as_unset(tmp_path, make_mbtiles, make_png):
    library = ImageryLibrary(tmp_path)
    tiles = make_mbtiles(tmp_path / "t.mbtiles", {(0, 0, 0): make_png()})
    old = library.add("old", tiles, _meta("Before the field existed"))
    assert (old.sensor, old.label, old.sample) == (None, None, False)
    odd = library.update("old", sensor="lidar", label={"ko": "", "en": 3})
    assert (odd.sensor, odd.label) == (None, None)


def test_the_pixel_size_is_what_was_stated_else_the_deepest_level(tmp_path, make_mbtiles, make_png):
    library = ImageryLibrary(tmp_path)

    def tiles():
        return make_mbtiles(tmp_path / "t.mbtiles", {(0, 0, 0): make_png()})

    stated = library.add("stated", tiles(), {**_meta("a"), "gsd_m": 0.31})
    assert stated.gsd_m == 0.31
    # Level 0 is 156.5 km a pixel at the equator; the set's middle is at 3 N.
    assert library.add("unstated", tiles(), _meta("b")).gsd_m == pytest.approx(156329, rel=1e-3)
    for odd in (0, -1, "0.5", True, None):
        assert library.update("stated", gsd_m=odd).gsd_m > 1000, odd
