"""Build the tiny GeoTIFFs the browser tests upload.

Run once when the fixtures should change; the output is committed:

    uv run python scripts/build_e2e_imagery.py

Writes `frontend/tests/fixtures/imagery/e2e-a.tif` and `e2e-b.tif`: two 64 px squares side by
side south of Jeju, one orange and one teal, each about 5 km across. A browser test cannot
build a GeoTIFF itself without an imaging library, and these are a few hundred bytes each.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

logger = logging.getLogger("build_e2e_imagery")

OUT = Path(__file__).resolve().parents[1] / "frontend" / "tests" / "fixtures" / "imagery"
SIZE_PX = 64
PIXEL_DEG = 0.0008
#: File stem -> (west, north, RGB).
TILES = {
    "e2e-a": (126.40, 33.10, (240, 140, 30)),
    "e2e-b": (126.46, 33.10, (20, 160, 150)),
}


def main() -> None:
    """Write every fixture."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    OUT.mkdir(parents=True, exist_ok=True)
    for stem, (west_deg, north_deg, colour) in TILES.items():
        data = np.empty((3, SIZE_PX, SIZE_PX), np.uint8)
        for band, value in enumerate(colour):
            data[band] = value
        path = OUT / f"{stem}.tif"
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=SIZE_PX,
            height=SIZE_PX,
            count=3,
            dtype="uint8",
            crs="EPSG:4326",
            transform=from_origin(west_deg, north_deg, PIXEL_DEG, PIXEL_DEG),
            compress="deflate",
        ) as target:
            target.write(data)
        logger.info("%s: %d bytes", path.name, path.stat().st_size)


if __name__ == "__main__":
    main()
