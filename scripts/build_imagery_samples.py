"""Build the sample imagery kept in the ``samples`` submodule.

    uv run python scripts/build_imagery_samples.py                # every sample
    uv run python scripts/build_imagery_samples.py --only umbra-incheon-airport

A maintainer runs this by hand; the server and the tests never do. It reads
``samples/manifest.toml``, downloads each source image from a public open-data bucket into
``.cache/imagery-samples/`` (several hundred MB apiece, kept so a rerun does not fetch them
again), cuts out a square around the place of interest and converts it with the same code the
server uses for an uploaded GeoTIFF. The result is ``samples/imagery/<slug>.mbtiles`` and its
``<slug>.json`` sidecar, which a SODA server lists as read-only samples.

A sample must stay under GitHub's 100 MiB file limit, because the submodule is a plain git
repository. When one comes out larger, the square is made smaller and the sample cut again;
the resolution is not reduced unless the manifest asks for it with ``pixel_m``.

Every source is open without a login and allows redistribution; the licence of each is in the
manifest and ends up in the sidecar and in ``samples/SOURCES.md``.
"""

import argparse
import json
import logging
import math
import shutil
import sys
import tomllib
import urllib.parse
import urllib.request
import warnings
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from soda.imagery import products, warp

logger = logging.getLogger("samples")

ROOT = Path(__file__).resolve().parent.parent
#: The largest file the submodule may hold; GitHub refuses 100 MiB.
MAX_SAMPLE_BYTES = 95 * 1024 * 1024
#: Below this a sample no longer shows a place, only a detail of it.
MIN_SIDE_KM = 2.0
#: The only places this script downloads from.
HOSTS = {
    "maxar-opendata.s3.amazonaws.com",
    "spacenet-dataset.s3.us-east-1.amazonaws.com",
    "satellogic-earthview.s3.us-west-2.amazonaws.com",
    "umbra-open-data-catalog.s3.us-west-2.amazonaws.com",
    "capella-open-data.s3.us-west-2.amazonaws.com",
}
_CHUNK = 4 * 1024 * 1024
_COPY_ROWS = 2048
_STAMP = "%Y-%m-%dT%H:%M:%S.%f"


def fetch(url: str, cache: Path) -> Path:
    """Download a file once; a rerun finds it in the cache."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in HOSTS:
        raise SystemExit(f"not an allowed source: {url}")
    target = (
        cache / parts.hostname / urllib.parse.unquote(parts.path).lstrip("/").replace("/", "__")
    )
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    logger.info("downloading %s", url)
    with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as handle:
        expected = int(response.headers.get("Content-Length") or 0)
        while chunk := response.read(_CHUNK):
            handle.write(chunk)
    if expected and partial.stat().st_size != expected:
        partial.unlink()
        raise SystemExit(f"short download of {url}")
    partial.replace(target)
    return target


def mosaic(urls: list[str], cache: Path, out: Path) -> Path:
    """Join small georeferenced chips that share a grid into one GeoTIFF."""
    import rasterio
    from rasterio.merge import merge

    with ThreadPoolExecutor(max_workers=8) as pool:
        chips = list(pool.map(lambda url: fetch(url, cache), urls))
    sources = [rasterio.open(chip) for chip in chips]
    try:
        data, transform = merge(sources)
        profile = sources[0].profile
    finally:
        for source in sources:
            source.close()
    profile.update(
        driver="GTiff",
        height=data.shape[1],
        width=data.shape[2],
        transform=transform,
        tiled=True,
        compress="deflate",
    )
    with rasterio.open(out, "w", **profile) as target:
        target.write(data)
    return out


def crop(
    source: Path,
    centre: tuple[float, float] | None,
    side_km: float,
    pixel_m: float | None,
    stretch: tuple[float, float] | None,
    out: Path,
) -> Path:
    """Copy a square around a point out of a georeferenced raster.

    Args:
        source: GeoTIFF to cut from.
        centre: ``lon, lat`` of the middle of the square; the raster's own middle when ``None``.
        side_km: Length of the square's side on the ground.
        pixel_m: Ground size to resample the pixels to, or ``None`` to keep them as they are.
        stretch: Low and high percentile of the cut-out to spread over 8 bits, band by
            band, which also evens out a colour cast; ``None`` to keep the values.
        out: GeoTIFF to write.
    """
    import rasterio
    from rasterio.enums import ColorInterp, MaskFlags, Resampling
    from rasterio.warp import transform
    from rasterio.windows import Window

    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True), rasterio.open(source) as src:
        if centre is None:
            x, y = (
                (src.bounds.left + src.bounds.right) / 2,
                (src.bounds.bottom + src.bounds.top) / 2,
            )
            (lon,), (lat,) = transform(src.crs, "EPSG:4326", [x], [y])
        else:
            lon, lat = centre
            (x,), (y,) = transform("EPSG:4326", src.crs, [lon], [lat])
        # Ground metres one pixel step covers along a row and down a column. Radar products are
        # often rotated, so the square is laid out along the image's own axes, in pixels.
        unit_x, unit_y = 1.0, 1.0
        if src.crs.is_geographic:
            unit_x, unit_y = 111_320.0 * math.cos(math.radians(lat)), 111_320.0
        step = src.transform
        across_m = math.hypot(step.a * unit_x, step.d * unit_y)
        down_m = math.hypot(step.b * unit_x, step.e * unit_y)
        col, row = ~step * (x, y)
        half_cols, half_rows = side_km * 500.0 / across_m, side_km * 500.0 / down_m
        wanted = Window(col - half_cols, row - half_rows, 2 * half_cols, 2 * half_rows)
        window = (
            wanted.round_offsets().round_lengths().intersection(Window(0, 0, src.width, src.height))
        )
        native_m = (across_m + down_m) / 2
        shrink = max(1.0, (pixel_m or native_m) / native_m)
        width, height = round(window.width / shrink), round(window.height / shrink)
        masked = MaskFlags.per_dataset in src.mask_flag_enums[0] and src.nodata is None
        low = high = np.zeros((src.count, 1, 1), np.float32)
        if stretch is not None:
            scale = max(1.0, max(window.width, window.height) / 1024)
            shape = (src.count, round(window.height / scale), round(window.width / scale))
            sample = src.read(window=window, out_shape=shape)
            # Zero is "no data" in every source used here, declared or not.
            limits = [np.percentile(band[band > 0], stretch) for band in sample]
            low = np.array([pair[0] for pair in limits], np.float32).reshape(-1, 1, 1)
            high = np.array([pair[1] for pair in limits], np.float32).reshape(-1, 1, 1)
        profile = {
            "driver": "GTiff",
            "width": width,
            "height": height,
            "count": src.count,
            "dtype": "uint8" if stretch is not None else src.dtypes[0],
            "crs": src.crs,
            # The window's corner, with pixels as large as the resampling makes them.
            "transform": src.window_transform(window)
            * rasterio.Affine.scale(window.width / width, window.height / height),
            "nodata": src.nodata,
            "tiled": True,
            "compress": "deflate",
        }
        with rasterio.open(out, "w", **profile) as target:
            rows = max(1, int(_COPY_ROWS * shrink))
            done = 0
            for top in range(0, int(window.height), rows):
                part = Window(
                    window.col_off,
                    window.row_off + top,
                    window.width,
                    min(rows, window.height - top),
                )
                out_rows = min(height - done, max(1, round(part.height / shrink)))
                if out_rows <= 0:
                    break
                shape = (src.count, out_rows, width)
                block = src.read(window=part, out_shape=shape, resampling=Resampling.average)
                if stretch is not None:
                    gain = 254.0 / np.maximum(high - low, 1.0)
                    spread = (block.astype(np.float32) - low) * gain + 1.0
                    block = np.where(block > 0, np.clip(spread, 1, 255), 0).astype(np.uint8)
                target.write(block, window=Window(0, done, width, out_rows))
                if masked:
                    mask = src.dataset_mask(window=part, out_shape=shape[1:])
                    target.write_mask(mask, window=Window(0, done, width, out_rows))
                done += out_rows
            if ColorInterp.undefined not in src.colorinterp:
                target.colorinterp = src.colorinterp
    return out


def _sidecar(
    sample: dict[str, Any],
    source_format: str,
    facts: dict[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    acquired = datetime.fromisoformat(sample["acquired_at"].replace("Z", "+00:00")).astimezone(UTC)
    return {
        "name": sample["label"]["en"],
        "label": sample["label"],
        "source_format": source_format,
        "sensor": sample["sensor"],
        **facts,
        # What the sensor resolves, which the manifest knows better than the pixel grid does.
        "gsd_m": sample.get("gsd_m", facts.get("gsd_m")),
        "attribution": sample["attribution"],
        "license": sample["license"],
        "origin": sample.get("origin"),
        "acquired_at": acquired.strftime(_STAMP)[:-3] + "Z",
        "created_at": created_at or datetime.now(UTC).strftime(_STAMP)[:-3] + "Z",
    }


_TILING = (
    "west_deg",
    "south_deg",
    "east_deg",
    "north_deg",
    "footprint",
    "min_zoom",
    "max_zoom",
    "tile_format",
    "tile_count",
)


def rewrite_sidecar(sample: dict[str, Any], samples_dir: Path) -> None:
    """Bring a built sample's sidecar up to date with the manifest without cutting it again."""
    path = samples_dir / "imagery" / f"{sample['slug']}.json"
    old = json.loads(path.read_text(encoding="utf-8"))
    facts = {key: old[key] for key in _TILING}
    sidecar = _sidecar(sample, old["source_format"], facts, old["created_at"])
    path.write_text(json.dumps(sidecar, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _quiet(_fraction: float) -> None:
    return None


def build(sample: dict[str, Any], cache: Path, samples_dir: Path) -> int:
    """Build one sample and return the size of its MBTiles file."""
    slug = sample["slug"]
    out_dir, work = samples_dir / "imagery", cache / "work"
    work.mkdir(parents=True, exist_ok=True)
    tiles = work / f"{slug}.mbtiles"
    tiles.unlink(missing_ok=True)
    if "scene" in sample:
        # A SPOT product the maintainer downloaded with their own CNES account.
        product = products.open_product(ROOT / sample["scene"])
        image = products.image_file(product, work)
        scene = product.scene
        facts = warp.import_scene(
            image, scene.corners, scene.bands, work / "scratch.tif", tiles, _quiet, scene.locate
        )
        image.unlink(missing_ok=True)
        source_format = "scene"
    else:
        if "chips_file" in sample:
            # One address per line: the small tiles a mosaic is made of.
            listing = (samples_dir / sample["chips_file"]).read_text(encoding="utf-8")
            source = mosaic(listing.split(), cache, work / f"{slug}-mosaic.tif")
        else:
            source = fetch(sample["url"], cache)
        centre = tuple(sample["center"]) if "center" in sample else None
        side_km = float(sample["side_km"])
        while True:
            stretch = tuple(sample["stretch"]) if "stretch" in sample else None
            cut = crop(
                source,
                centre,
                side_km,
                sample.get("pixel_m"),
                stretch,
                work / f"{slug}-crop.tif",
            )
            tiles.unlink(missing_ok=True)
            facts = warp.import_geotiff(cut, tiles, _quiet)
            size = tiles.stat().st_size
            if size <= MAX_SAMPLE_BYTES:
                break
            smaller = side_km * math.sqrt(MAX_SAMPLE_BYTES * 0.93 / size)
            logger.info(
                "%s: %.1f MB at %.2f km, trying %.2f km", slug, size / 1e6, side_km, smaller
            )
            if smaller < MIN_SIDE_KM:
                raise SystemExit(f"{slug}: does not fit in {MAX_SAMPLE_BYTES} bytes above 2 km")
            side_km = smaller
        facts["side_km"] = round(side_km, 2)
        source_format = "geotiff"
    side = facts.pop("side_km", None)
    size = tiles.stat().st_size
    if size > MAX_SAMPLE_BYTES:
        raise SystemExit(f"{slug}: {size} bytes is over the file limit")
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(tiles, out_dir / f"{slug}.mbtiles")
    sidecar = _sidecar(sample, source_format, facts)
    (out_dir / f"{slug}.json").write_text(
        json.dumps(sidecar, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    logger.info(
        "%s: %.1f MB, zoom %s-%s, %s tiles%s",
        slug,
        size / 1e6,
        facts["min_zoom"],
        facts["max_zoom"],
        facts["tile_count"],
        f", {side} km" if side else "",
    )
    return size


_SOURCES_HEAD = """# 샘플 영상 출처

이 표는 `scripts/build_imagery_samples.py`가 `manifest.toml`과 만들어진 파일에서 다시 쓴다. 손으로
고치지 않는다. 라이선스별 조건은 [LICENSE.md](LICENSE.md)에 있다.

- 모든 원본은 로그인 없이 받는 공개 버킷에 있다. SPOT 5만 CNES 계정으로 받은 제품에서 만들었다.
- 가공: 원본에서 표의 범위만 잘라 Web Mercator 타일로 다시 만들었다. `늘림`은 그 범위의 밝기를
  적은 백분위 구간으로 8비트에 맞춘 것이고, 밴드마다 따로 맞춘다.
- SAR는 레이더 반사 세기라 사진과 다르게 보인다.

| 파일 | 지역 | 센서·해상도 | 범위·줌·크기 | 촬영 (UTC) | 가공 | 라이선스 | 출처 표기 | 만든 날 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
"""


def write_sources(manifest: list[dict[str, Any]], samples_dir: Path) -> None:
    """Rewrite ``SOURCES.md`` from the manifest and the sidecars of what has been built."""
    rows = []
    originals = []
    for sample in manifest:
        sidecar = samples_dir / "imagery" / f"{sample['slug']}.json"
        tiles = sidecar.with_suffix(".mbtiles")
        if not sidecar.is_file() or not tiles.is_file():
            continue
        facts = json.loads(sidecar.read_text(encoding="utf-8"))
        middle = math.radians((facts["south_deg"] + facts["north_deg"]) / 2)
        width_km = (facts["east_deg"] - facts["west_deg"]) * 111.32 * math.cos(middle)
        height_km = (facts["north_deg"] - facts["south_deg"]) * 111.32
        extent = (
            f"{width_km:.1f} × {height_km:.1f} km · 줌 {facts['min_zoom']}–{facts['max_zoom']} · "
            f"{tiles.stat().st_size / 1e6:.0f} MB"
        )
        steps = []
        if "stretch" in sample:
            steps.append(f"늘림 {sample['stretch'][0]:g}–{sample['stretch'][1]:g}%")
        if "pixel_m" in sample:
            steps.append(f"픽셀 {sample['pixel_m']:g} m로 줄임")
        if "chips_file" in sample:
            steps.append("조각 이어 붙임")
        if "scene" in sample:
            steps.append("장면 전체, 위치 모델로 폄")
        rows.append(
            f"| `{sample['slug']}` | {sample['label']['ko']} | "
            f"{'SAR' if sample['sensor'] == 'sar' else '광학'} {facts['gsd_m']:g} m | {extent} | "
            f"{facts['acquired_at'][:16].replace('T', ' ')} | {', '.join(steps) or '자르기만'} | "
            f"{sample['license']} | {sample['attribution']} | {facts['created_at'][:10]} |"
        )
        where = sample.get("url") or sample.get("chips_file") or "CNES 계정으로 받은 SPOT 5 제품"
        originals.append(f"- `{sample['slug']}`: {f'<{where}>' if '://' in where else where}")
    text = _SOURCES_HEAD + "\n".join(rows) + "\n\n## 원본\n\n" + "\n".join(originals) + "\n"
    (samples_dir / "SOURCES.md").write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--samples", type=Path, default=ROOT / "samples")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache" / "imagery-samples")
    parser.add_argument("--only", action="append", help="build only this slug (repeatable)")
    parser.add_argument("--sources", action="store_true", help="only rewrite SOURCES.md")
    parser.add_argument(
        "--sidecars", action="store_true", help="rewrite the sidecars from the manifest, no cutting"
    )
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    warnings.simplefilter("ignore")
    with (arguments.samples / "manifest.toml").open("rb") as handle:
        manifest = tomllib.load(handle)["sample"]
    chosen = [s for s in manifest if not arguments.only or s["slug"] in arguments.only]
    if not chosen:
        raise SystemExit("no such sample")
    total = 0
    for sample in chosen:
        if arguments.sidecars:
            rewrite_sidecar(sample, arguments.samples)
        elif not arguments.sources:
            total += build(sample, arguments.cache, arguments.samples)
    write_sources(manifest, arguments.samples)
    if not arguments.sources and not arguments.sidecars:
        print(f"{len(chosen)} samples, {total / 1e6:.0f} MB", file=sys.stderr)


if __name__ == "__main__":
    np.seterr(all="ignore")
    main()
