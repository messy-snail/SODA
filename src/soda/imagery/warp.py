"""Reading an image or a GeoTIFF with rasterio and handing it to ``cutting``.

rasterio is imported inside the functions: it loads GDAL, which the server does not need to
start, to serve tiles, or to accept an MBTiles upload.

A plain image carries no georeferencing, so it is first copied into a scratch GeoTIFF whose
ground control points are its four corners; from there both inputs are cut the same way. A
scene in sensor geometry (a TIFF whose corners come from the product's metadata) goes the
same way as a plain image.
"""

import logging
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from .cutting import Plan, Progress, cut
from .formats import ImageryError, is_tiff, raster_kind
from .limits import MAX_GEOTIFF_PIXELS, MAX_IMAGERY_PIXELS
from .tiling import (
    MAX_LAT_DEG,
    ORIGIN_M,
    Corners,
    corners_bounds_m,
    corners_resolution_m,
    gcp_grid,
    mercator,
)

logger = logging.getLogger(__name__)

#: Image rows copied at a time into the scratch GeoTIFF.
_COPY_ROWS = 1024
_MERCATOR = "EPSG:3857"
_DRIVERS = {"png": "PNG", "jpg": "JPEG"}
# Stop GDAL from looking at anything beside the one file it was given.
_GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_PAM_ENABLED": "NO"}
#: Control points along each side when a scene brings its own location model.
_MODEL_GRID = 5

#: ``(col, row, x_m, y_m)``: an image position, from its top-left corner, and where it lies.
ControlPoints = list[tuple[float, float, float, float]]


def _rasterio() -> Any:
    try:
        import rasterio
    except ImportError as error:
        raise ImageryError(
            "imageryWarpUnavailable",
            "영상 변환 라이브러리(rasterio)를 불러올 수 없음 · MBTiles 업로드는 가능",
        ) from error
    return rasterio


def _check_pixels(width: int, height: int, limit: int) -> None:
    if width * height > limit:
        megapixels = limit // 1_000_000
        raise ImageryError(
            "imageryTooManyPixels",
            f"영상은 {megapixels} 메가픽셀 이하만 변환 가능",
            max_mp=megapixels,
        )


def _colour_bands(src: Any) -> tuple[tuple[int, ...], int | None]:
    """Band indexes to show as colour, and the alpha band when the source has one."""
    from rasterio.enums import ColorInterp

    interp = list(src.colorinterp)
    alpha = interp.index(ColorInterp.alpha) + 1 if ColorInterp.alpha in interp else None
    wanted = (ColorInterp.red, ColorInterp.green, ColorInterp.blue)
    if all(colour in interp for colour in wanted):
        return tuple(interp.index(colour) + 1 for colour in wanted), alpha
    others = [index for index in range(1, src.count + 1) if index != alpha]
    return (tuple(others[:3]) if len(others) >= 3 else (others[0],)), alpha


def _stretch(
    src: Any, bands: tuple[int, ...], *, always: bool = False
) -> tuple[tuple[float, float], ...] | None:
    """A 2-98 percentile stretch per band, from a small decimated read.

    An 8-bit source is shown as it is unless ``always`` is set: a picture is already made for
    the eye, while the raw counts of a sensor fill only part of the range.
    """
    if src.dtypes[0] == "uint8" and not always:
        return None
    scale = max(1.0, max(src.width, src.height) / 1024)
    shape = (max(1, round(src.height / scale)), max(1, round(src.width / scale)))
    limits = []
    for band in bands:
        sample = src.read(band, out_shape=shape, masked=True).compressed().astype(np.float64)
        sample = sample[np.isfinite(sample)]
        low, high = (0.0, 1.0) if sample.size == 0 else np.percentile(sample, (2, 98))
        limits.append((float(low), float(high) if high > low else float(low) + 1.0))
    return tuple(limits)


def _open(rasterio: Any, path: Path, driver: str, unreadable: ImageryError) -> Any:
    """Open with one named driver, so GDAL never probes formats that reference other files."""
    try:
        return rasterio.open(path, driver=driver)
    except rasterio.errors.RasterioError as error:
        raise unreadable from error


def _image_unreadable() -> ImageryError:
    return ImageryError("imageryImageUnreadable", "PNG 또는 JPEG 이미지를 읽을 수 없음")


def _geotiff_unreadable() -> ImageryError:
    return ImageryError(
        "imageryGeotiffUnreadable", "GeoTIFF를 읽을 수 없음 · 밴드·자료형 확인 필요"
    )


def _head(path: Path) -> bytes:
    with path.open("rb") as source:
        return source.read(16)


def check_image(path: Path) -> None:
    """Cheap signature check done before an import is queued.

    Raises:
        ImageryError: ``imageryImageUnreadable`` when the file is not a PNG or JPEG.
    """
    if raster_kind(_head(path)) not in _DRIVERS:
        raise _image_unreadable()


def check_geotiff(path: Path) -> None:
    """Cheap signature check done before an import is queued.

    Raises:
        ImageryError: ``imageryGeotiffUnreadable`` when the file is not a TIFF.
    """
    if not is_tiff(_head(path)):
        raise _geotiff_unreadable()


def _georeference(
    rasterio: Any,
    src: Any,
    corners: Corners,
    scratch: Path,
    bands: tuple[int, ...] | None = None,
    points: ControlPoints | None = None,
) -> None:
    """Copy an image into a GeoTIFF that carries its corners as ground control points.

    GDAL reads control points from the dataset, and PNG and JPEG cannot hold them. A palette
    image is expanded to RGBA on the way, so the warp can blend its colours. With ``bands``,
    only those source bands are copied, in that order, as red, green and blue (or grey).
    With ``points``, those are the control points instead of a grid between the corners.
    """
    from rasterio.control import GroundControlPoint
    from rasterio.enums import ColorInterp
    from rasterio.windows import Window

    try:
        palette = src.colormap(1) if src.count == 1 else None
    except ValueError:
        palette = None
    lookup = None
    if palette is not None:
        lookup = np.zeros((256, 4), np.uint8)
        for index, colour in palette.items():
            lookup[index] = colour
    count = 4 if lookup is not None else src.count
    interp = (
        [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
        if lookup is not None
        else list(src.colorinterp)
    )
    if bands is not None:
        lookup, count = None, len(bands)
        interp = (
            [ColorInterp.red, ColorInterp.green, ColorInterp.blue]
            if count == 3
            else [ColorInterp.gray]
        )
    with rasterio.open(
        scratch,
        "w",
        driver="GTiff",
        width=src.width,
        height=src.height,
        count=count,
        dtype=src.dtypes[0],
        tiled=True,
    ) as target:
        for top in range(0, src.height, _COPY_ROWS):
            window = Window(0, top, src.width, min(_COPY_ROWS, src.height - top))
            rows = src.read(list(bands) if bands is not None else None, window=window)
            if lookup is not None:
                rows = np.moveaxis(lookup[rows[0]], -1, 0)
            target.write(rows, window=window)
        target.colorinterp = interp
        target.gcps = (
            [
                GroundControlPoint(row=row, col=col, x=x_m, y=y_m)
                for col, row, x_m, y_m in points or gcp_grid(corners, src.width, src.height)
            ],
            _MERCATOR,
        )


def import_image(
    source: Path, corners: Corners, target: Path, progress: Progress
) -> dict[str, Any]:
    """Stretch a PNG or JPEG onto its four corners and cut it into an MBTiles file.

    Args:
        source: Image file. A scratch GeoTIFF is written beside it.
        corners: ``lon, lat`` of the top-left, top-right, bottom-right and bottom-left corners.
        target: MBTiles file to create.
        progress: Called with the fraction of tiles done; it may raise to cancel.

    Returns:
        The tiling fields of the set's sidecar, with the corners as its footprint.

    Raises:
        ImageryError: When the image cannot be read or is too large.
    """
    check_image(source)
    rasterio = _rasterio()
    scratch = source.with_name("georeferenced.tif")
    with warnings.catch_warnings(), rasterio.Env(**_GDAL_ENV):
        # A plain image has no georeferencing, which is exactly why the corners are given.
        warnings.simplefilter("ignore", rasterio.errors.NotGeoreferencedWarning)
        driver = _DRIVERS[raster_kind(_head(source)) or ""]
        try:
            with _open(rasterio, source, driver, _image_unreadable()) as image:
                _check_pixels(image.width, image.height, MAX_IMAGERY_PIXELS)
                _georeference(rasterio, image, corners, scratch)
            with rasterio.open(scratch, driver="GTiff") as src:
                bands, alpha_band = _colour_bands(src)
                plan = Plan(
                    bands=bands,
                    alpha_band=alpha_band,
                    stretch=_stretch(src, bands),
                    bounds_m=corners_bounds_m(corners),
                    res_m=corners_resolution_m(corners, src.width, src.height),
                )
                facts = cut(rasterio, src, plan, target, progress)
        except rasterio.errors.RasterioError as error:
            raise _image_unreadable() from error
        finally:
            scratch.unlink(missing_ok=True)
    return {**facts, "footprint": list(corners)}


def _scene_unreadable() -> ImageryError:
    return ImageryError(
        "imageryProductInvalid", "제품의 영상 파일을 읽을 수 없음 · 밴드·자료형 확인 필요"
    )


def _model_points(
    locate: Callable[[float, float], tuple[float, float]], width: int, height: int
) -> ControlPoints:
    """Control points on an even grid, placed by a scene's own location model.

    The model counts rows and columns from 1 at pixel centres, so the image's top-left
    corner is at ``(0.5, 0.5)`` in its terms.
    """
    points: ControlPoints = []
    for i in range(_MODEL_GRID):
        for j in range(_MODEL_GRID):
            col, row = width * j / (_MODEL_GRID - 1), height * i / (_MODEL_GRID - 1)
            lon, lat = locate(row + 0.5, col + 0.5)
            if abs(lon) > 180 or abs(lat) > MAX_LAT_DEG:
                raise _scene_unreadable()
            points.append((col, row, *mercator(lon, lat)))
    return points


def import_scene(
    source: Path,
    corners: Corners,
    bands: tuple[int, ...],
    scratch: Path,
    target: Path,
    progress: Progress,
    locate: Callable[[float, float], tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """Stretch a scene in sensor geometry onto its four corners and cut it into MBTiles.

    The corners, or the product's simplified location model when it has one, are all that
    places it: there is no terrain or rigorous sensor model, so this is not an
    orthorectification and the ground can sit off by the relief displacement of the scene.

    Args:
        source: TIFF holding the scene; any georeferencing in it is ignored.
        corners: ``lon, lat`` of the top-left, top-right, bottom-right and bottom-left corners.
        bands: One band to show as grey, or three to show as red, green and blue.
        scratch: Where the scratch GeoTIFF may be written; removed before returning.
        target: MBTiles file to create.
        progress: Called with the fraction of tiles done; it may raise to cancel.
        locate: ``(row, col)`` of a pixel centre, counted from 1, to ``(lon, lat)``. With it
            the image follows this model between the corners instead of straight edges.

    Returns:
        The tiling fields of the set's sidecar, with the corners as its footprint.

    Raises:
        ImageryError: When the file cannot be read, lacks a band, or is too large.
    """
    if not is_tiff(_head(source)) or len(bands) not in (1, 3):
        raise _scene_unreadable()
    rasterio = _rasterio()
    with warnings.catch_warnings(), rasterio.Env(**_GDAL_ENV):
        warnings.simplefilter("ignore", rasterio.errors.NotGeoreferencedWarning)
        try:
            with _open(rasterio, source, "GTiff", _scene_unreadable()) as scene:
                _check_pixels(scene.width, scene.height, MAX_GEOTIFF_PIXELS)
                complex_values = np.dtype(scene.dtypes[0]).kind == "c"
                if complex_values or not all(1 <= band <= scene.count for band in bands):
                    raise _scene_unreadable()
                points = (
                    _model_points(locate, scene.width, scene.height) if locate is not None else None
                )
                _georeference(rasterio, scene, corners, scratch, bands, points)
            bounds_m = corners_bounds_m(corners)
            if points is not None:
                # An edge that bows outward reaches past the box of the corners.
                xs, ys = [point[2] for point in points], [point[3] for point in points]
                bounds_m = (min(xs), min(ys), max(xs), max(ys))
            with rasterio.open(scratch, driver="GTiff") as src:
                shown = tuple(range(1, len(bands) + 1))
                plan = Plan(
                    bands=shown,
                    alpha_band=None,
                    stretch=_stretch(src, shown, always=True),
                    bounds_m=bounds_m,
                    res_m=corners_resolution_m(corners, src.width, src.height),
                )
                facts = cut(rasterio, src, plan, target, progress)
        except rasterio.errors.RasterioError as error:
            raise _scene_unreadable() from error
        finally:
            scratch.unlink(missing_ok=True)
    return {**facts, "footprint": list(corners)}


def import_geotiff(source: Path, target: Path, progress: Progress) -> dict[str, Any]:
    """Reproject a georeferenced GeoTIFF or COG and cut it into an MBTiles file.

    Args:
        source: GeoTIFF file.
        target: MBTiles file to create.
        progress: Called with the fraction of tiles done; it may raise to cancel.

    Returns:
        The tiling fields of the set's sidecar.

    Raises:
        ImageryError: When the file cannot be read, has no georeferencing, or is too large.
    """
    check_geotiff(source)
    rasterio = _rasterio()
    from rasterio.warp import calculate_default_transform, transform_bounds

    with warnings.catch_warnings(), rasterio.Env(**_GDAL_ENV):
        warnings.simplefilter("ignore", rasterio.errors.NotGeoreferencedWarning)
        with _open(rasterio, source, "GTiff", _geotiff_unreadable()) as src:
            _check_pixels(src.width, src.height, MAX_GEOTIFF_PIXELS)
            if src.crs is None or src.transform.is_identity:
                raise ImageryError(
                    "imageryNotGeoreferenced",
                    "좌표 정보가 없는 TIFF · 좌표계와 변환이 들어 있는 GeoTIFF 필요",
                )
            if src.count < 1 or np.dtype(src.dtypes[0]).kind == "c":
                raise _geotiff_unreadable()
            try:
                transform, _, _ = calculate_default_transform(
                    src.crs, _MERCATOR, src.width, src.height, *src.bounds
                )
                west, south, east, north = transform_bounds(
                    src.crs, _MERCATOR, *src.bounds, densify_pts=21
                )
                bands, alpha_band = _colour_bands(src)
                # Mercator has no poles; whatever lies beyond its square is left out.
                limit = ORIGIN_M
                plan = Plan(
                    bands=bands,
                    alpha_band=alpha_band,
                    stretch=_stretch(src, bands),
                    bounds_m=(
                        max(west, -limit),
                        max(south, -limit),
                        min(east, limit),
                        min(north, limit),
                    ),
                    res_m=abs(transform.a),
                )
                if plan.bounds_m[0] >= plan.bounds_m[2] or plan.bounds_m[1] >= plan.bounds_m[3]:
                    logger.info("GeoTIFF lies outside +/-%.2f deg latitude", MAX_LAT_DEG)
                    raise _geotiff_unreadable()

                def overview(index: int) -> Any:
                    return rasterio.open(source, driver="GTiff", overview_level=index)

                facts = cut(rasterio, src, plan, target, progress, reopen=overview)
            except rasterio.errors.RasterioError as error:
                raise _geotiff_unreadable() from error
    return {**facts, "footprint": None}
