"""Web Mercator tile arithmetic and the geometry of a four-corner footprint.

Pure functions: no file access and no imaging library. Tile coordinates are XYZ (row 0 at the
north); MBTiles stores TMS rows, and ``mbtiles.tms_row`` converts.
"""

import math

from .formats import ImageryError

TILE_PX = 256
#: Half the width of the Web Mercator square, in metres.
ORIGIN_M = 20037508.342789244
#: Latitude where the Web Mercator square ends.
MAX_LAT_DEG = 85.0511287798066

Bounds = tuple[float, float, float, float]
Corners = tuple[float, float, float, float, float, float, float, float]


def mercator(lon_deg: float, lat_deg: float) -> tuple[float, float]:
    """EPSG:3857 metres for a longitude and latitude."""
    lat = max(-MAX_LAT_DEG, min(MAX_LAT_DEG, lat_deg))
    x_m = lon_deg * ORIGIN_M / 180.0
    y_m = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * ORIGIN_M / math.pi
    return x_m, y_m


def lonlat(x_m: float, y_m: float) -> tuple[float, float]:
    """Longitude and latitude in degrees for EPSG:3857 metres."""
    lon_deg = x_m * 180.0 / ORIGIN_M
    lat_deg = math.degrees(2 * math.atan(math.exp(y_m * math.pi / ORIGIN_M)) - math.pi / 2)
    return lon_deg, lat_deg


def resolution_m(zoom: int) -> float:
    """Mercator metres per pixel at a zoom level."""
    return 2 * ORIGIN_M / (TILE_PX * 2**zoom)


def tile_bounds_m(zoom: int, x: int, y: int) -> Bounds:
    """``(west, south, east, north)`` of an XYZ tile in Mercator metres."""
    size = 2 * ORIGIN_M / 2**zoom
    west = -ORIGIN_M + x * size
    north = ORIGIN_M - y * size
    return west, north - size, west + size, north


def tile_range(zoom: int, bounds_m: Bounds) -> tuple[int, int, int, int]:
    """Inclusive XYZ tile range ``(x0, y0, x1, y1)`` covering Mercator bounds."""
    west, south, east, north = bounds_m
    size = 2 * ORIGIN_M / 2**zoom
    last = 2**zoom - 1

    def clamp(value: float) -> int:
        return max(0, min(last, int(value)))

    # Nudge the far edges inward so bounds that end exactly on a tile edge do not spill over.
    epsilon = size * 1e-9
    return (
        clamp((west + ORIGIN_M) / size),
        clamp((ORIGIN_M - north) / size),
        clamp((east - epsilon + ORIGIN_M) / size),
        clamp((ORIGIN_M - south - epsilon) / size),
    )


def tiles_bounds_deg(zoom: int, x0: int, y0: int, x1: int, y1: int) -> Bounds:
    """``(west, south, east, north)`` in degrees of an inclusive XYZ tile range."""
    west, _, _, north = tile_bounds_m(zoom, x0, y0)
    _, south, east, _ = tile_bounds_m(zoom, x1, y1)
    west_deg, south_deg = lonlat(west, south)
    east_deg, north_deg = lonlat(east, north)
    return west_deg, south_deg, east_deg, north_deg


def max_zoom_for(res_m: float, limit: int) -> int:
    """Deepest level worth cutting for a source with ``res_m`` Mercator metres per pixel.

    The 0.1 level of slack keeps a source that falls 7% short of a level from being cut one
    level deeper, which would quadruple the tiles for no visible gain.
    """
    if not math.isfinite(res_m) or res_m <= 0:
        return 0
    return max(0, min(limit, math.ceil(math.log2(resolution_m(0) / res_m) - 0.1)))


def min_zoom_for(max_zoom: int, bounds_m: Bounds) -> int:
    """Level at which the bounds fit in about one tile, so the top of the pyramid stays small."""
    west, south, east, north = bounds_m
    longest_px = max(east - west, north - south) / resolution_m(max_zoom)
    if longest_px <= TILE_PX:
        return max_zoom
    return max(0, max_zoom - math.ceil(math.log2(longest_px / TILE_PX)))


def plan_levels(
    res_m: float, bounds_m: Bounds, zoom_limit: int, tile_limit: int
) -> tuple[int, int]:
    """``(min_zoom, max_zoom)`` to cut for a source, kept within a tile budget.

    A source finer than the budget allows is cut one level shallower at a time until its whole
    pyramid fits. It loses its last bit of sharpness instead of being refused.
    """
    max_zoom = max_zoom_for(res_m, zoom_limit)
    while True:
        min_zoom = min_zoom_for(max_zoom, bounds_m)
        tiles = 0
        for zoom in range(min_zoom, max_zoom + 1):
            x0, y0, x1, y1 = tile_range(zoom, bounds_m)
            tiles += (x1 - x0 + 1) * (y1 - y0 + 1)
        if tiles <= tile_limit or max_zoom == 0:
            return min_zoom, max_zoom
        max_zoom -= 1


def overview_for(shrink: float, factors: list[int]) -> int | None:
    """Index of the coarsest overview that is still at least as fine as a level needs.

    Args:
        shrink: How many source pixels one pixel of the level covers along an axis.
        factors: The source's overview decimation factors, ascending (2, 4, 8, ...).

    Returns:
        An index into ``factors``, or ``None`` to read the full-resolution pixels.
    """
    best = None
    for index, factor in enumerate(factors):
        if factor <= shrink:
            best = index
    return best


def parse_corners(text: str) -> Corners:
    """Eight comma-separated numbers: ``lon,lat`` of the top-left, top-right, bottom-right and
    bottom-left image corners.

    Raises:
        ImageryError: ``imageryCornersInvalid`` when the text is not eight usable numbers or the
            corners do not form a quadrilateral an image can be stretched onto.
    """
    try:
        values = tuple(float(part) for part in text.split(","))
    except ValueError as error:
        raise _bad_corners() from error
    if len(values) != 8:
        raise _bad_corners()
    check_corners(values)
    return values


def _bad_corners() -> ImageryError:
    return ImageryError(
        "imageryCornersInvalid",
        "네 모서리 좌표 확인 필요 · 좌상, 우상, 우하, 좌하 순서의 경도·위도 8개 값",
    )


def check_corners(corners: tuple[float, ...]) -> None:
    """Reject corners that are out of range, cross the antimeridian, or are not a convex quad.

    Raises:
        ImageryError: ``imageryCornersInvalid``.
    """
    if len(corners) != 8 or not all(math.isfinite(value) for value in corners):
        raise _bad_corners()
    lons, lats = corners[0::2], corners[1::2]
    if any(abs(lon) > 180 for lon in lons) or any(abs(lat) > MAX_LAT_DEG for lat in lats):
        raise _bad_corners()
    # A footprint wider than half the globe is far more likely one that crosses the antimeridian.
    if max(lons) - min(lons) >= 180:
        raise _bad_corners()
    points = [mercator(lon, lat) for lon, lat in zip(lons, lats, strict=True)]
    turns = []
    for index in range(4):
        ax, ay = points[index]
        bx, by = points[(index + 1) % 4]
        cx, cy = points[(index + 2) % 4]
        turns.append((bx - ax) * (cy - by) - (by - ay) * (cx - bx))
    # Every turn has the same sign in a convex quad; zero means collinear or repeated corners.
    if not (all(turn > 0 for turn in turns) or all(turn < 0 for turn in turns)):
        raise _bad_corners()


def corners_bounds_m(corners: Corners) -> Bounds:
    """Mercator bounding box of the four corners."""
    points = [mercator(lon, lat) for lon, lat in zip(corners[0::2], corners[1::2], strict=True)]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def corners_resolution_m(corners: Corners, width_px: int, height_px: int) -> float:
    """Mercator metres per source pixel, averaged over the four edges of the footprint."""
    (tl, tr, br, bl) = [
        mercator(lon, lat) for lon, lat in zip(corners[0::2], corners[1::2], strict=True)
    ]
    across = (math.dist(tl, tr) + math.dist(bl, br)) / 2 / width_px
    down = (math.dist(tl, bl) + math.dist(tr, br)) / 2 / height_px
    return (across + down) / 2


def gcp_grid(
    corners: Corners, width_px: int, height_px: int, points: int = 3
) -> list[tuple[float, float, float, float]]:
    """Ground control points ``(col, row, x_m, y_m)`` spread over the image.

    Four corner points alone make GDAL fit an affine transform, which cannot reach four
    arbitrary corners. A grid interpolated bilinearly between them makes it fit a second-order
    polynomial, which can.
    """
    (tl, tr, br, bl) = [
        mercator(lon, lat) for lon, lat in zip(corners[0::2], corners[1::2], strict=True)
    ]
    grid = []
    for j in range(points):
        for i in range(points):
            u, v = i / (points - 1), j / (points - 1)
            weights = ((1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v)
            x_m = sum(w * p[0] for w, p in zip(weights, (tl, tr, br, bl), strict=True))
            y_m = sum(w * p[1] for w, p in zip(weights, (tl, tr, br, bl), strict=True))
            grid.append((u * width_px, v * height_px, x_m, y_m))
    return grid
