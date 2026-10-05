"""Cutting an open raster into Web Mercator tiles and writing them as MBTiles.

Called by ``warp`` once it has worked out how to read a source. rasterio is imported inside
the functions, like everywhere else in this package.

Tiles the source covers fully are stored as JPEG, tiles on its edge as WebP with alpha (a
lossless PNG of a photograph is ten times larger), and tiles it does not touch are not stored.
"""

import math
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .formats import ImageryError, raster_kind
from .limits import MAX_IMPORT_TILES, MAX_IMPORT_ZOOM
from .mbtiles import MbtilesWriter
from .tiling import (
    TILE_PX,
    Bounds,
    lonlat,
    overview_for,
    plan_levels,
    resolution_m,
    tile_bounds_m,
    tile_range,
)

Progress = Callable[[float], None]
#: Opens the source again at one of its overviews, by index into ``dataset.overviews()``.
Reopen = Callable[[int], Any]

#: Tiles warped in one call along each axis; 8 keeps a block at 2048 px a side.
_BLOCK_TILES = 8
_QUALITY = 85
_MERCATOR = "EPSG:3857"
#: Warp threads. The warp is the slow half of a block; encoding stays on the calling thread.
_THREADS = min(4, os.cpu_count() or 1)
#: Below this much shrinking a bilinear read is as good as an average, and sharper.
_AVERAGE_FROM = 1.5


@dataclass(frozen=True)
class Plan:
    """How to read a source: which bands are colour, and how to bring them to 8 bits."""

    bands: tuple[int, ...]
    alpha_band: int | None
    #: ``(low, high)`` per colour band for sources that are not 8-bit, else ``None``.
    stretch: tuple[tuple[float, float], ...] | None
    bounds_m: Bounds
    #: Mercator metres per source pixel.
    res_m: float


def _to_bytes(block: np.ndarray, plan: Plan) -> tuple[np.ndarray, np.ndarray]:
    """Split a warped block into 8-bit RGB ``(3, h, w)`` and an alpha mask ``(h, w)``."""
    colour, alpha = block[:-1], block[-1] > 0
    if plan.stretch is not None:
        scaled = np.empty(colour.shape, np.uint8)
        for index, (low, high) in enumerate(plan.stretch):
            values = (colour[index].astype(np.float64) - low) * (255.0 / (high - low))
            scaled[index] = np.clip(np.nan_to_num(values), 0, 255)
        colour = scaled
    if colour.shape[0] == 1:
        colour = np.repeat(colour, 3, axis=0)
    return colour, alpha


def _encode(rasterio: Any, rgb: np.ndarray, alpha: np.ndarray, lossy_alpha: bool) -> bytes | None:
    """JPEG for a fully covered tile, an image with alpha for a partial one, nothing for an
    empty one."""
    if not alpha.any():
        return None
    options: dict[str, Any]
    if alpha.all():
        options, data = {"driver": "JPEG", "count": 3, "quality": _QUALITY}, rgb
    else:
        options = (
            {"driver": "WEBP", "count": 4, "quality": _QUALITY}
            if lossy_alpha
            else {"driver": "PNG", "count": 4}
        )
        data = np.concatenate([rgb, (alpha * np.uint8(255))[None]])
    with rasterio.io.MemoryFile() as memory:
        with memory.open(width=TILE_PX, height=TILE_PX, dtype="uint8", **options) as target:
            target.write(np.ascontiguousarray(data))
        return memory.read()


def cut(
    rasterio: Any,
    src: Any,
    plan: Plan,
    target: Path,
    progress: Progress,
    reopen: Reopen | None = None,
) -> dict[str, Any]:
    """Warp the source level by level and write the tiles.

    Args:
        rasterio: The imported module.
        src: Open dataset at full resolution.
        plan: How to read it.
        target: MBTiles file to create.
        progress: Called with the fraction of tiles done; it may raise to cancel.
        reopen: Opens the same source at an overview. With it, each level below the top is
            read from the coarsest overview that is still finer than the level, instead of
            averaging the full-resolution pixels every time.

    Returns:
        The set's tiling facts: bounds, zoom range, tile format and count, and the ground
        size of a source pixel.
    """
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.warp import reproject

    min_zoom, max_zoom = plan_levels(plan.res_m, plan.bounds_m, MAX_IMPORT_ZOOM, MAX_IMPORT_TILES)
    levels = list(range(max_zoom, min_zoom - 1, -1))
    ranges = {zoom: tile_range(zoom, plan.bounds_m) for zoom in levels}
    total = sum((x1 - x0 + 1) * (y1 - y0 + 1) for x0, y0, x1, y1 in ranges.values())
    factors = list(src.overviews(plan.bands[0])) if reopen is not None else []
    alpha_index = len(plan.bands) + 1
    extra = {} if plan.alpha_band is None else {"src_alpha": plan.alpha_band}
    # GDAL builds without WebP exist; PNG is the lossless stand-in.
    lossy_alpha = "WEBP" in rasterio.drivers.raster_driver_extensions().values()
    kinds: set[str] = set()
    done = 0
    opened: dict[int, Any] = {}
    writer = MbtilesWriter(target)
    try:
        for zoom in levels:
            res = resolution_m(zoom)
            shrink = res / plan.res_m
            overview = overview_for(shrink, factors)
            dataset = src
            if overview is not None and reopen is not None:
                if overview not in opened:
                    opened[overview] = reopen(overview)
                dataset = opened[overview]
                shrink /= factors[overview]
            source = rasterio.band(dataset, list(plan.bands))
            resampling = Resampling.average if shrink >= _AVERAGE_FROM else Resampling.bilinear
            x0, y0, x1, y1 = ranges[zoom]
            for by in range(y0, y1 + 1, _BLOCK_TILES):
                for bx in range(x0, x1 + 1, _BLOCK_TILES):
                    columns = min(_BLOCK_TILES, x1 - bx + 1)
                    rows = min(_BLOCK_TILES, y1 - by + 1)
                    west, _, _, north = tile_bounds_m(zoom, bx, by)
                    block = np.zeros(
                        (alpha_index, rows * TILE_PX, columns * TILE_PX), src.dtypes[0]
                    )
                    reproject(
                        source=source,
                        destination=block,
                        dst_transform=from_origin(west, north, res, res),
                        dst_crs=_MERCATOR,
                        dst_alpha=alpha_index,
                        resampling=resampling,
                        init_dest_nodata=True,
                        num_threads=_THREADS,
                        **extra,
                    )
                    rgb, alpha = _to_bytes(block, plan)
                    for row in range(rows):
                        for column in range(columns):
                            window = (
                                slice(row * TILE_PX, (row + 1) * TILE_PX),
                                slice(column * TILE_PX, (column + 1) * TILE_PX),
                            )
                            data = _encode(
                                rasterio, rgb[(slice(None), *window)], alpha[window], lossy_alpha
                            )
                            if data is not None:
                                writer.add(zoom, bx + column, by + row, data)
                                kinds.add(raster_kind(data) or "")
                    done += rows * columns
                    progress(done / total)
        if writer.count == 0:
            raise ImageryError("imageryImportFailed", "영상에서 타일을 만들지 못함")
        west_deg, south_deg = lonlat(plan.bounds_m[0], plan.bounds_m[1])
        east_deg, north_deg = lonlat(plan.bounds_m[2], plan.bounds_m[3])
        tile_format = kinds.pop() if len(kinds) == 1 else "mixed"
        writer.finish(
            {
                "format": "png" if tile_format == "mixed" else tile_format,
                "type": "overlay",
                "minzoom": str(min_zoom),
                "maxzoom": str(max_zoom),
                "bounds": f"{west_deg},{south_deg},{east_deg},{north_deg}",
            }
        )
    except BaseException:
        writer.abort()
        raise
    finally:
        for dataset in opened.values():
            dataset.close()
    # A Mercator metre is 1/cos(latitude) of a ground metre.
    middle = math.radians((south_deg + north_deg) / 2)
    return {
        "west_deg": west_deg,
        "south_deg": south_deg,
        "east_deg": east_deg,
        "north_deg": north_deg,
        "gsd_m": round(plan.res_m * math.cos(middle), 3),
        "min_zoom": min_zoom,
        "max_zoom": max_zoom,
        "tile_format": tile_format,
        "tile_count": writer.count,
    }
