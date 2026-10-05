import math

import pytest

from soda.imagery.formats import ImageryError
from soda.imagery.tiling import (
    MAX_LAT_DEG,
    ORIGIN_M,
    corners_bounds_m,
    corners_resolution_m,
    gcp_grid,
    lonlat,
    max_zoom_for,
    mercator,
    min_zoom_for,
    overview_for,
    parse_corners,
    plan_levels,
    resolution_m,
    tile_bounds_m,
    tile_range,
    tiles_bounds_deg,
)

# Top-left, top-right, bottom-right, bottom-left of a tilted footprint west of Seoul.
QUAD = (126.0, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95)


def test_mercator_round_trips_and_spans_the_square():
    assert mercator(0.0, 0.0) == pytest.approx((0.0, 0.0), abs=1e-6)
    assert mercator(180.0, MAX_LAT_DEG) == pytest.approx((ORIGIN_M, ORIGIN_M), rel=1e-9)
    assert lonlat(*mercator(127.3, 36.4)) == pytest.approx((127.3, 36.4), abs=1e-9)


def test_tile_bounds_and_range_agree():
    west, south, east, north = tile_bounds_m(3, 5, 2)
    assert east - west == pytest.approx(2 * ORIGIN_M / 8)
    assert north - south == pytest.approx(2 * ORIGIN_M / 8)
    # Bounds that are exactly one tile select exactly that tile.
    assert tile_range(3, (west, south, east, north)) == (5, 2, 5, 2)
    # The whole square at level 0 is the single root tile.
    assert tile_range(0, (-ORIGIN_M, -ORIGIN_M, ORIGIN_M, ORIGIN_M)) == (0, 0, 0, 0)


def test_tiles_bounds_cover_the_world_at_level_zero():
    west, south, east, north = tiles_bounds_deg(0, 0, 0, 0, 0)
    assert (west, east) == pytest.approx((-180.0, 180.0))
    assert (south, north) == pytest.approx((-MAX_LAT_DEG, MAX_LAT_DEG))


@pytest.mark.parametrize(
    ("res_m", "zoom"),
    [
        (resolution_m(11), 11),
        # 5% coarser than level 12 still rounds to 12; 20% coarser stays at the same level
        # because cutting less would throw detail away.
        (resolution_m(12) * 1.05, 12),
        (resolution_m(12) * 1.2, 12),
        (resolution_m(12) * 0.5, 13),
        (0.001, 20),
        (float("nan"), 0),
    ],
)
def test_max_zoom_follows_the_source_resolution(res_m, zoom):
    assert max_zoom_for(res_m, 20) == zoom


def test_min_zoom_is_where_the_footprint_fits_one_tile():
    res = resolution_m(12)
    bounds = (0.0, 0.0, 256 * 8 * res, 256 * 3 * res)
    assert min_zoom_for(12, bounds) == 9
    assert min_zoom_for(12, (0.0, 0.0, 100 * res, 100 * res)) == 12
    assert min_zoom_for(2, (0.0, 0.0, 256 * 64 * resolution_m(2), 10.0)) == 0


def test_parse_corners_accepts_a_tilted_quad():
    text = ",".join(str(value) for value in QUAD)
    assert parse_corners(text) == QUAD
    # Either winding is a valid quad.
    reversed_quad = (QUAD[0], QUAD[1], QUAD[6], QUAD[7], QUAD[4], QUAD[5], QUAD[2], QUAD[3])
    assert parse_corners(",".join(map(str, reversed_quad))) == reversed_quad


@pytest.mark.parametrize(
    "text",
    [
        "",
        "1,2,3",
        "a,b,c,d,e,f,g,h",
        "126,37,127,37,127,36,126,nan",
        # Latitude beyond the Mercator square.
        "10,89,11,89,11,88,10,88",
        "190,10,191,10,191,9,190,9",
        # Crosses the antimeridian.
        "179,10,-179,10,-179,9,179,9",
        # Self-intersecting (bow tie): the two right corners are swapped.
        "126,37.6,126.95,37.1,126.8,37.75,126.15,36.95",
        # Degenerate: three corners on one line.
        "0,0,1,0,2,0,1,-1",
        "5,5,5,5,5,5,5,5",
    ],
)
def test_parse_corners_rejects_unusable_input(text):
    with pytest.raises(ImageryError) as caught:
        parse_corners(text)
    assert caught.value.code == "imageryCornersInvalid"


def test_corner_geometry_matches_the_quad():
    west, south, east, north = corners_bounds_m(QUAD)
    assert lonlat(west, south) == pytest.approx((126.0, 36.95))
    assert lonlat(east, north) == pytest.approx((126.95, 37.75))
    top = math.dist(mercator(126.0, 37.6), mercator(126.8, 37.75))
    res = corners_resolution_m(QUAD, 1000, 1000)
    assert res == pytest.approx(top / 1000, rel=0.1)


def test_gcp_grid_pins_the_corners_and_the_centre():
    grid = gcp_grid(QUAD, 400, 200)
    assert len(grid) == 9
    by_pixel = {(col, row): (x, y) for col, row, x, y in grid}
    assert by_pixel[(0.0, 0.0)] == pytest.approx(mercator(126.0, 37.6))
    assert by_pixel[(400.0, 0.0)] == pytest.approx(mercator(126.8, 37.75))
    assert by_pixel[(400.0, 200.0)] == pytest.approx(mercator(126.95, 37.1))
    assert by_pixel[(0.0, 200.0)] == pytest.approx(mercator(126.15, 36.95))
    corners = [mercator(lon, lat) for lon, lat in zip(QUAD[0::2], QUAD[1::2], strict=True)]
    centre = (sum(p[0] for p in corners) / 4, sum(p[1] for p in corners) / 4)
    assert by_pixel[(200.0, 100.0)] == pytest.approx(centre)


def test_plan_levels_follows_the_resolution_when_the_budget_allows():
    res = resolution_m(12)
    bounds = (0.0, 0.0, 256 * 8 * res, 256 * 3 * res)
    assert plan_levels(res, bounds, 20, 60_000) == (9, 12)
    assert plan_levels(0.001, bounds, 14, 60_000)[1] == 14


def test_plan_levels_cuts_shallower_until_the_pyramid_fits():
    res = resolution_m(12)
    bounds = (0.0, 0.0, 256 * 8 * res, 256 * 3 * res)
    # Level 12 alone is 8 x 3 tiles; a budget of 20 forces one level up.
    min_zoom, max_zoom = plan_levels(res, bounds, 20, 20)
    assert max_zoom == 11
    tiles = 0
    for zoom in range(min_zoom, max_zoom + 1):
        x0, y0, x1, y1 = tile_range(zoom, bounds)
        tiles += (x1 - x0 + 1) * (y1 - y0 + 1)
    assert tiles <= 20
    # An impossible budget still returns a level rather than looping.
    assert plan_levels(res, bounds, 20, 0) == (0, 0)


@pytest.mark.parametrize(
    ("shrink", "index"),
    [(1.0, None), (1.9, None), (2.0, 0), (3.9, 0), (4.0, 1), (100.0, 3), (0.5, None)],
)
def test_overview_for_picks_the_coarsest_usable_overview(shrink, index):
    assert overview_for(shrink, [2, 4, 8, 16]) == index
    assert overview_for(shrink, []) is None
