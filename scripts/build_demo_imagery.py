"""Make the GeoTIFF that the ``imagery-add`` README clip uploads.

The clip shows a user registering their own file, so it needs a real-looking image that may
be shown publicly. This stitches the tiles of one CC BY 4.0 sample from the ``samples``
submodule back into a small Web Mercator GeoTIFF under ``.cache``. Nothing it writes is
committed.

Run by a maintainer before ``demo:record``::

    uv run python scripts/build_demo_imagery.py
"""

from __future__ import annotations

import math
import sqlite3
import sys
import warnings
from pathlib import Path

import numpy as np
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parent.parent
#: Satellogic EarthView, CC BY 4.0 (see ``samples/SOURCES.md``).
SOURCE = ROOT / "samples" / "imagery" / "satellogic-busan-new-port.mbtiles"
TARGET = ROOT / ".cache" / "demo-assets" / "busan-new-port.tif"
ZOOM = 16
TILE = 256
#: Half the width of the Web Mercator square, in metres.
EDGE_M = math.pi * 6378137.0


def main() -> int:
    """Stitch one zoom level of the sample into a GeoTIFF."""
    if not SOURCE.is_file():
        print(f"{SOURCE} is missing; run git submodule update --init samples", file=sys.stderr)
        return 1
    with sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True) as db:
        rows = db.execute(
            "SELECT tile_column, tile_row, tile_data FROM tiles WHERE zoom_level = ?", (ZOOM,)
        ).fetchall()
    columns = [row[0] for row in rows]
    # MBTiles counts rows from the south (TMS); flip them to count from the north.
    norths = [(1 << ZOOM) - 1 - row[1] for row in rows]
    x0, y0 = min(columns), min(norths)
    width = (max(columns) - x0 + 1) * TILE
    height = (max(norths) - y0 + 1) * TILE
    image = np.zeros((4, height, width), dtype=np.uint8)
    # A map tile carries no georeferencing of its own; its place comes from its index.
    warnings.simplefilter("ignore", NotGeoreferencedWarning)
    for (column, _, data), north in zip(rows, norths, strict=True):
        with MemoryFile(data) as memory, memory.open() as tile:
            pixels = tile.read()
        left, top = (column - x0) * TILE, (north - y0) * TILE
        image[: pixels.shape[0], top : top + TILE, left : left + TILE] = pixels
        if pixels.shape[0] < 4:
            image[3, top : top + TILE, left : left + TILE] = 255
    metres_per_pixel = 2 * EDGE_M / ((1 << ZOOM) * TILE)
    transform = from_origin(
        -EDGE_M + x0 * TILE * metres_per_pixel,
        EDGE_M - y0 * TILE * metres_per_pixel,
        metres_per_pixel,
        metres_per_pixel,
    )
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        TARGET,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=4,
        dtype="uint8",
        crs="EPSG:3857",
        transform=transform,
        compress="deflate",
        photometric="RGB",
        alpha="YES",
    ) as output:
        output.write(image)
    print(f"{TARGET.relative_to(ROOT)}  {width}x{height}  {TARGET.stat().st_size / 2**20:.1f} MiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
