"""Warping with rasterio. This is the only test module that imports it."""

import sqlite3
import struct
import warnings
import zlib
from contextlib import closing

import numpy as np
import pytest
import rasterio
from conftest import scene_model
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from soda.imagery import mbtiles, warp
from soda.imagery.formats import ImageryError
from soda.imagery.tiling import TILE_PX, mercator, resolution_m, tile_bounds_m, tile_range

# Top-left, top-right, bottom-right, bottom-left of a tilted footprint west of Seoul.
QUAD = (126.0, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95)
RED, GREEN, BLUE, WHITE = (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)


def png_bytes(pixels: np.ndarray) -> bytes:
    """Encode an ``(h, w, 4)`` uint8 array as a PNG without an imaging library."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    height, width, _ = pixels.shape
    rows = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def quadrants(size: int = 400) -> np.ndarray:
    """Red top-left, green top-right, blue bottom-right, white bottom-left."""
    pixels = np.zeros((size, size, 4), np.uint8)
    half = size // 2
    pixels[:half, :half, :3] = RED
    pixels[:half, half:, :3] = GREEN
    pixels[half:, half:, :3] = BLUE
    pixels[half:, :half, :3] = WHITE
    pixels[..., 3] = 255
    return pixels


def pixel_at(path, zoom: int, x_m: float, y_m: float) -> tuple[int, int, int, int]:
    """RGBA of the stored tile pixel at a Mercator position; transparent where no tile is."""
    x, y, _, _ = tile_range(zoom, (x_m, y_m, x_m, y_m))
    data = mbtiles.read_tile(path, zoom, x, y)
    if data is None:
        return (0, 0, 0, 0)
    west, _, _, north = tile_bounds_m(zoom, x, y)
    res = resolution_m(zoom)
    col = min(TILE_PX - 1, int((x_m - west) / res))
    row = min(TILE_PX - 1, int((north - y_m) / res))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with MemoryFile(data) as memory, memory.open() as tile:
            values = tile.read()[:, row, col]
    r, g, b = (int(v) for v in values[:3])
    return (r, g, b, int(values[3]) if len(values) == 4 else 255)


def close_to(actual: tuple[int, ...], expected: tuple[int, ...], tolerance: int = 40) -> bool:
    """JPEG tiles are lossy, so colours are compared loosely."""
    return all(abs(a - e) <= tolerance for a, e in zip(actual, expected, strict=False))


def quad_points() -> list[tuple[float, float]]:
    return [mercator(lon, lat) for lon, lat in zip(QUAD[0::2], QUAD[1::2], strict=True)]


def toward_centre(point, fraction: float) -> tuple[float, float]:
    points = quad_points()
    cx, cy = sum(p[0] for p in points) / 4, sum(p[1] for p in points) / 4
    return point[0] + (cx - point[0]) * fraction, point[1] + (cy - point[1]) * fraction


@pytest.fixture
def quadrant_set(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(png_bytes(quadrants()))
    target = tmp_path / "tiles.mbtiles"
    ticks: list[float] = []
    facts = warp.import_image(source, QUAD, target, ticks.append)
    return target, facts, ticks


def test_each_image_corner_lands_on_its_ground_corner(quadrant_set):
    target, facts, ticks = quadrant_set
    zoom = facts["max_zoom"]
    for point, colour in zip(quad_points(), (RED, GREEN, BLUE, WHITE), strict=True):
        inside = pixel_at(target, zoom, *toward_centre(point, 0.1))
        assert inside[3] == 255 and close_to(inside, colour), (colour, inside)
        outside = pixel_at(target, zoom, *toward_centre(point, -0.05))
        assert outside[3] == 0, (colour, outside)
    assert ticks[-1] == pytest.approx(1.0)
    assert ticks == sorted(ticks)


def test_the_footprint_edge_is_within_a_few_pixels(quadrant_set):
    target, facts, _ = quadrant_set
    zoom = facts["max_zoom"]
    res = resolution_m(zoom)
    points = quad_points()
    longest = max(np.hypot(a[0] - b[0], a[1] - b[1]) for a in points for b in points)
    step = 4 * res / (longest / 2)
    for point in points:
        assert pixel_at(target, zoom, *toward_centre(point, step))[3] == 255
        assert pixel_at(target, zoom, *toward_centre(point, -step))[3] == 0


def test_import_facts_describe_the_set(quadrant_set):
    target, facts, _ = quadrant_set
    assert facts["footprint"] == list(QUAD)
    assert (facts["west_deg"], facts["south_deg"]) == pytest.approx((126.0, 36.95))
    assert (facts["east_deg"], facts["north_deg"]) == pytest.approx((126.95, 37.75))
    # About 220 m per source pixel lands on level 10, and the footprint fits one tile by level 8.
    assert (facts["min_zoom"], facts["max_zoom"]) == (8, 10)
    info = mbtiles.inspect(target)
    assert (info.min_zoom, info.max_zoom, info.tile_count) == (8, 10, facts["tile_count"])
    # Tiles inside the footprint are JPEG, tiles on its edge are WebP with alpha. Inspection
    # only samples a few tiles, so it may see one kind.
    assert facts["tile_format"] == "mixed"
    assert info.tile_format in {"webp", "jpg", "mixed"}
    with closing(sqlite3.connect(target)) as db:
        kinds = {bytes(row[0][:3]) for row in db.execute("SELECT tile_data FROM tiles")}
    assert kinds == {b"\xff\xd8\xff", b"RIF"}
    assert info.bounds_deg == pytest.approx(
        (facts["west_deg"], facts["south_deg"], facts["east_deg"], facts["north_deg"])
    )


def test_source_alpha_stays_transparent(tmp_path):
    pixels = quadrants()
    pixels[:200, :200, 3] = 0
    source = tmp_path / "source"
    source.write_bytes(png_bytes(pixels))
    target = tmp_path / "tiles.mbtiles"
    facts = warp.import_image(source, QUAD, target, lambda _fraction: None)
    red, green = quad_points()[0], quad_points()[1]
    assert pixel_at(target, facts["max_zoom"], *toward_centre(red, 0.2))[3] == 0
    assert pixel_at(target, facts["max_zoom"], *toward_centre(green, 0.2))[3] == 255


def test_a_jpeg_is_accepted(tmp_path):
    source = tmp_path / "source"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(
            source, "w", driver="JPEG", width=64, height=64, count=3, dtype="uint8"
        ) as image:
            image.write(np.full((3, 64, 64), 200, np.uint8))
    target = tmp_path / "tiles.mbtiles"
    facts = warp.import_image(source, QUAD, target, lambda _fraction: None)
    centre = toward_centre(quad_points()[0], 1.0)
    assert close_to(pixel_at(target, facts["max_zoom"], *centre), (200, 200, 200))


def test_a_cancelled_import_leaves_no_usable_file(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(png_bytes(quadrants()))
    target = tmp_path / "tiles.mbtiles"

    class Stop(Exception):
        pass

    def cancel(_fraction: float) -> None:
        raise Stop

    with pytest.raises(Stop):
        warp.import_image(source, QUAD, target, cancel)
    # The file is closed, so the caller can remove it even on Windows.
    target.unlink()


@pytest.mark.parametrize(
    "content",
    [b"definitely not an image", b"GIF89a" + b"\x00" * 64, b"\x89PNG\r\n\x1a\n" + b"junk" * 32],
)
def test_unreadable_images_are_rejected(tmp_path, content):
    source = tmp_path / "source"
    source.write_bytes(content)
    with pytest.raises(ImageryError) as caught:
        warp.import_image(source, QUAD, tmp_path / "tiles.mbtiles", lambda _fraction: None)
    assert caught.value.code == "imageryImageUnreadable"


def test_the_pixel_limit_applies_before_anything_is_read(tmp_path, monkeypatch):
    monkeypatch.setattr(warp, "MAX_IMAGERY_PIXELS", 400 * 400 - 1)
    source = tmp_path / "source"
    source.write_bytes(png_bytes(quadrants()))
    with pytest.raises(ImageryError) as caught:
        warp.import_image(source, QUAD, tmp_path / "tiles.mbtiles", lambda _fraction: None)
    assert caught.value.code == "imageryTooManyPixels"
    assert not (tmp_path / "tiles.mbtiles").exists()


def write_geotiff(path, data: np.ndarray, **profile) -> None:
    count, height, width = data.shape
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=width,
            height=height,
            count=count,
            dtype=data.dtype,
            **profile,
        ) as target:
            target.write(data)


def test_a_geographic_geotiff_keeps_its_place_and_colour(tmp_path):
    data = np.zeros((3, 100, 200), np.uint8)
    data[0, :, :100] = 255
    data[2, :, 100:] = 255
    source = tmp_path / "source"
    # 0.002 deg pixels: 0.4 deg wide, 0.2 deg tall, north-west corner at 127 E, 37 N.
    write_geotiff(source, data, crs="EPSG:4326", transform=from_origin(127.0, 37.0, 0.002, 0.002))
    target = tmp_path / "tiles.mbtiles"
    facts = warp.import_geotiff(source, target, lambda _fraction: None)
    assert facts["footprint"] is None
    assert (facts["west_deg"], facts["north_deg"]) == pytest.approx((127.0, 37.0), abs=1e-6)
    assert (facts["east_deg"], facts["south_deg"]) == pytest.approx((127.4, 36.8), abs=1e-6)
    zoom = facts["max_zoom"]
    assert close_to(pixel_at(target, zoom, *mercator(127.1, 36.9)), (*RED, 255))
    assert close_to(pixel_at(target, zoom, *mercator(127.3, 36.9)), (*BLUE, 255))
    assert pixel_at(target, zoom, *mercator(127.45, 36.9))[3] == 0
    assert pixel_at(target, zoom, *mercator(127.1, 37.05))[3] == 0


def test_a_projected_16_bit_geotiff_is_stretched_to_grey(tmp_path):
    ramp = np.tile(np.linspace(1000, 5000, 300, dtype=np.uint16), (200, 1))[None]
    source = tmp_path / "source"
    write_geotiff(
        source, ramp, crs="EPSG:32652", transform=from_origin(300000, 4150000, 10, 10), nodata=0
    )
    target = tmp_path / "tiles.mbtiles"
    facts = warp.import_geotiff(source, target, lambda _fraction: None)
    # 10 m pixels at 37.5 N are about 12.6 m in Mercator, which is level 14.
    assert facts["max_zoom"] == 14
    with rasterio.open(source) as src:
        west, south, east, north = rasterio.warp.transform_bounds(src.crs, "EPSG:3857", *src.bounds)
    middle_y = (south + north) / 2
    dark = pixel_at(target, 14, west + (east - west) * 0.15, middle_y)
    bright = pixel_at(target, 14, west + (east - west) * 0.85, middle_y)
    assert dark[3] == bright[3] == 255
    assert dark[0] == dark[1] == dark[2] and bright[0] == bright[1] == bright[2]
    assert dark[0] < 80 and bright[0] > 180


def test_nodata_is_transparent(tmp_path):
    data = np.full((1, 100, 100), 120, np.uint8)
    data[:, :, :50] = 0
    source = tmp_path / "source"
    write_geotiff(
        source,
        data,
        crs="EPSG:4326",
        transform=from_origin(127.0, 37.0, 0.002, 0.002),
        nodata=0,
    )
    target = tmp_path / "tiles.mbtiles"
    facts = warp.import_geotiff(source, target, lambda _fraction: None)
    assert pixel_at(target, facts["max_zoom"], *mercator(127.05, 36.9))[3] == 0
    assert close_to(pixel_at(target, facts["max_zoom"], *mercator(127.15, 36.9)), (120, 120, 120))


def test_a_tiff_without_georeferencing_is_rejected(tmp_path):
    source = tmp_path / "source"
    write_geotiff(source, np.zeros((1, 10, 10), np.uint8))
    with pytest.raises(ImageryError) as caught:
        warp.import_geotiff(source, tmp_path / "tiles.mbtiles", lambda _fraction: None)
    assert caught.value.code == "imageryNotGeoreferenced"


@pytest.mark.parametrize("content", [b"not a tiff", b"II*\x00" + b"\xff" * 64])
def test_unreadable_geotiffs_are_rejected(tmp_path, content):
    source = tmp_path / "source"
    source.write_bytes(content)
    with pytest.raises(ImageryError) as caught:
        warp.import_geotiff(source, tmp_path / "tiles.mbtiles", lambda _fraction: None)
    assert caught.value.code == "imageryGeotiffUnreadable"


def test_the_geotiff_pixel_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(warp, "MAX_GEOTIFF_PIXELS", 99)
    source = tmp_path / "source"
    write_geotiff(
        source,
        np.zeros((1, 10, 10), np.uint8),
        crs="EPSG:4326",
        transform=from_origin(127.0, 37.0, 0.002, 0.002),
    )
    with pytest.raises(ImageryError) as caught:
        warp.import_geotiff(source, tmp_path / "tiles.mbtiles", lambda _fraction: None)
    assert caught.value.code == "imageryTooManyPixels"
    assert caught.value.params == {"max_mp": 0}


def test_an_internal_mask_is_transparent(tmp_path):
    """Maxar's visual tiles carry no nodata value, only a mask beside the pixels."""
    data = np.full((1, 100, 100), 120, np.uint8)
    mask = np.full((100, 100), 255, np.uint8)
    mask[:, :50] = 0
    source = tmp_path / "source"
    with (
        rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True),
        rasterio.open(
            source,
            "w",
            driver="GTiff",
            width=100,
            height=100,
            count=1,
            dtype="uint8",
            crs="EPSG:4326",
            transform=from_origin(127.0, 37.0, 0.002, 0.002),
        ) as target,
    ):
        target.write(data)
        target.write_mask(mask)
    tiles = tmp_path / "tiles.mbtiles"
    facts = warp.import_geotiff(source, tiles, lambda _fraction: None)
    assert pixel_at(tiles, facts["max_zoom"], *mercator(127.05, 36.9))[3] == 0
    assert close_to(pixel_at(tiles, facts["max_zoom"], *mercator(127.15, 36.9)), (120, 120, 120))


def test_overviews_give_the_same_picture(tmp_path):
    """Lower levels are read from overviews when the file has them."""
    data = np.zeros((3, 512, 1024), np.uint8)
    data[0, :, :512] = 255
    data[2, :, 512:] = 255
    plain, pyramid = tmp_path / "plain", tmp_path / "pyramid"
    profile = {"crs": "EPSG:4326", "transform": from_origin(127.0, 37.0, 0.0005, 0.0005)}
    write_geotiff(plain, data, **profile)
    write_geotiff(pyramid, data, **profile)
    with rasterio.open(pyramid, "r+") as target:
        target.build_overviews([2, 4, 8], rasterio.enums.Resampling.average)
    facts = [
        warp.import_geotiff(source, tmp_path / f"{source.name}.mbtiles", lambda _fraction: None)
        for source in (plain, pyramid)
    ]
    assert facts[0] == facts[1]
    assert facts[0]["min_zoom"] < facts[0]["max_zoom"]
    for zoom in range(facts[0]["min_zoom"], facts[0]["max_zoom"] + 1):
        for name in ("plain", "pyramid"):
            tiles = tmp_path / f"{name}.mbtiles"
            assert close_to(pixel_at(tiles, zoom, *mercator(127.1, 36.9)), (*RED, 255)), zoom
            assert close_to(pixel_at(tiles, zoom, *mercator(127.4, 36.9)), (*BLUE, 255)), zoom


def test_the_tile_budget_lowers_the_top_level(tmp_path, monkeypatch):
    from soda.imagery import cutting

    data = np.full((3, 512, 1024), 90, np.uint8)
    source = tmp_path / "source"
    write_geotiff(source, data, crs="EPSG:4326", transform=from_origin(127.0, 37.0, 0.0005, 0.0005))
    full = warp.import_geotiff(source, tmp_path / "full.mbtiles", lambda _fraction: None)
    monkeypatch.setattr(cutting, "MAX_IMPORT_TILES", full["tile_count"] // 2)
    capped = warp.import_geotiff(source, tmp_path / "capped.mbtiles", lambda _fraction: None)
    assert capped["max_zoom"] < full["max_zoom"]
    assert capped["tile_count"] <= full["tile_count"] // 2
    # The picture is still there, just less sharp.
    centre = mercator(127.25, 36.87)
    assert close_to(pixel_at(tmp_path / "capped.mbtiles", capped["max_zoom"], *centre), (90,) * 3)


def grey_quadrants(size: int = 400) -> np.ndarray:
    """Raw counts as a sensor leaves them: a narrow range, darkest top-left, rising clockwise."""
    data = np.zeros((1, size, size), np.uint8)
    half = size // 2
    data[0, :half, :half] = 40
    data[0, :half, half:] = 70
    data[0, half:, half:] = 100
    data[0, half:, :half] = 130
    return data


def test_a_scene_lands_on_its_corners_and_is_stretched(tmp_path):
    source = tmp_path / "IMAGERY.TIF"
    write_geotiff(source, grey_quadrants())
    target, scratch = tmp_path / "tiles.mbtiles", tmp_path / "georeferenced.tif"
    ticks: list[float] = []
    facts = warp.import_scene(source, QUAD, (1,), scratch, target, ticks.append)

    zoom = facts["max_zoom"]
    seen = []
    for point in quad_points():
        inside = pixel_at(target, zoom, *toward_centre(point, 0.1))
        assert inside[3] == 255 and inside[0] == inside[1] == inside[2], inside
        assert pixel_at(target, zoom, *toward_centre(point, -0.05))[3] == 0
        seen.append(inside[0])
    # 40..130 fills the whole range once stretched, in the order the corners were given.
    assert seen == sorted(seen)
    assert seen[0] < 20 and seen[-1] > 235
    assert facts["footprint"] == list(QUAD)
    assert (facts["min_zoom"], facts["max_zoom"]) == (8, 10)
    assert ticks[-1] == pytest.approx(1.0)
    assert not scratch.exists()


def test_a_scene_shows_the_bands_its_metadata_names(tmp_path):
    # Four bands, as SPOT multispectral has; the third is bright on the left half only.
    data = np.full((4, 200, 200), 60, np.uint8)
    data[2, :, :100] = 180
    data[3] = 255
    source = tmp_path / "IMAGERY.TIF"
    write_geotiff(source, data)
    target = tmp_path / "tiles.mbtiles"
    facts = warp.import_scene(
        source, QUAD, (3, 2, 1), tmp_path / "scratch.tif", target, lambda _fraction: None
    )
    points = quad_points()
    left = pixel_at(target, facts["max_zoom"], *toward_centre(points[0], 0.3))
    right = pixel_at(target, facts["max_zoom"], *toward_centre(points[1], 0.3))
    assert left[0] > 200 and right[0] < 60
    # The other two shown bands are flat, so they stay equal across the scene.
    assert abs(left[1] - right[1]) <= 40 and abs(left[2] - right[2]) <= 40


def test_georeferencing_in_a_scene_file_is_ignored(tmp_path):
    """A level 1A TIFF carries its corner tie points; the metadata's corners are what count."""
    source = tmp_path / "IMAGERY.TIF"
    write_geotiff(
        source,
        grey_quadrants(),
        crs="EPSG:4326",
        transform=from_origin(10.0, 50.0, 0.002, 0.002),
    )
    facts = warp.import_scene(
        source, QUAD, (1,), tmp_path / "s.tif", tmp_path / "t.mbtiles", lambda _fraction: None
    )
    assert (facts["west_deg"], facts["north_deg"]) == pytest.approx((126.0, 37.75))


@pytest.mark.parametrize(
    ("content", "bands"),
    [(b"not a tiff", (1,)), (b"II*\x00" + b"\xff" * 64, (1,)), (None, (2,)), (None, (1, 1))],
)
def test_unreadable_scenes_are_rejected(tmp_path, content, bands):
    source = tmp_path / "IMAGERY.TIF"
    if content is None:
        write_geotiff(source, grey_quadrants(40))
    else:
        source.write_bytes(content)
    scratch = tmp_path / "georeferenced.tif"
    with pytest.raises(ImageryError) as caught:
        warp.import_scene(
            source, QUAD, bands, scratch, tmp_path / "tiles.mbtiles", lambda _fraction: None
        )
    assert caught.value.code == "imageryProductInvalid"
    assert not scratch.exists()


def test_a_scene_may_be_larger_than_a_plain_image(tmp_path, monkeypatch):
    """SPOT 5 scenes run to 576 megapixels, far over what a PNG or JPEG may have."""
    monkeypatch.setattr(warp, "MAX_IMAGERY_PIXELS", 10)
    source = tmp_path / "IMAGERY.TIF"
    write_geotiff(source, grey_quadrants(40))
    arguments = (source, QUAD, (1,), tmp_path / "s.tif", tmp_path / "t.mbtiles")
    assert warp.import_scene(*arguments, lambda _fraction: None)["tile_count"] > 0
    monkeypatch.setattr(warp, "MAX_GEOTIFF_PIXELS", 10)
    with pytest.raises(ImageryError) as caught:
        warp.import_scene(*arguments, lambda _fraction: None)
    assert caught.value.code == "imageryTooManyPixels"


def test_a_location_model_bends_the_scene_between_its_corners(tmp_path):
    """SPOT's simplified model is second order: the edges of a scene are not straight."""
    source = tmp_path / "IMAGERY.TIF"
    write_geotiff(source, np.full((1, 400, 400), 90, np.uint8))

    def tiles(name: str, locate):
        target = tmp_path / f"{name}.mbtiles"
        facts = warp.import_scene(
            source, QUAD, (1,), tmp_path / "s.tif", target, lambda _fraction: None, locate
        )
        return target, facts

    straight, facts = tiles("straight", None)
    # The same corners, with the middle columns pushed 0.05 degrees south.
    lon_terms, lat_terms = scene_model(400, QUAD, bow_deg=0.05)

    def locate(row: float, col: float) -> tuple[float, float]:
        powers = (1.0, row, col, row * col, row * row, col * col)
        return (
            sum(t * p for t, p in zip(lon_terms, powers, strict=True)),
            sum(t * p for t, p in zip(lat_terms, powers, strict=True)),
        )

    bent, bent_facts = tiles("bent", locate)
    zoom = facts["max_zoom"]
    top = mercator((QUAD[0] + QUAD[2]) / 2, (QUAD[1] + QUAD[3]) / 2 - 0.02)
    bottom = mercator((QUAD[4] + QUAD[6]) / 2, (QUAD[5] + QUAD[7]) / 2 - 0.02)
    # Just inside the straight top edge is now outside; just below the bottom edge is inside.
    assert pixel_at(straight, zoom, *top)[3] == 255 and pixel_at(bent, zoom, *top)[3] == 0
    assert pixel_at(straight, zoom, *bottom)[3] == 0 and pixel_at(bent, zoom, *bottom)[3] == 255
    # The corners themselves have not moved.
    for point in quad_points():
        assert pixel_at(bent, zoom, *toward_centre(point, 0.1))[3] == 255
    # The bounds grow to hold the bowed bottom edge; the footprint stays the four corners.
    assert bent_facts["south_deg"] < facts["south_deg"]
    assert bent_facts["footprint"] == list(QUAD)


def test_the_ground_size_of_a_pixel_is_recorded(tmp_path):
    """Metres on the ground, not Mercator metres, which grow with latitude."""
    data = np.full((1, 60, 60), 120, np.uint8)
    cases = {
        # 0.0001 degrees is 11.1 m at the equator.
        "equator": ({"crs": "EPSG:4326", "transform": from_origin(10.0, 0.003, 1e-4, 1e-4)}, 11.1),
        # 10 m pixels in UTM at 37.5 N are 12.6 m in Mercator, and still 10 m on the ground.
        "utm": ({"crs": "EPSG:32652", "transform": from_origin(300000, 4150000, 10, 10)}, 10.0),
    }
    for name, (profile, expected) in cases.items():
        source = tmp_path / name
        write_geotiff(source, data, **profile)
        facts = warp.import_geotiff(source, tmp_path / f"{name}.mbtiles", lambda _fraction: None)
        assert facts["gsd_m"] == pytest.approx(expected, rel=0.02), name
