"""Reading the ``METADATA.DIM`` of a SPOT scene product (DIMAP 1.1).

A level 1A scene is an image in sensor geometry: its TIFF carries no usable georeferencing,
and the metadata beside it says where the four corner pixels fall on the ground. That, the
name of the image file and what to call the scene are all this module takes from the file,
along with the simplified location model when there is one: a second-order polynomial from
row and column to longitude and latitude that follows the curve of the scan between the
corners. The orbit, attitude and calibration blocks are not read.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath

from ..gp.ndm import parse_xml
from .formats import ImageryError
from .limits import MAX_ATTRIBUTION_LENGTH, MAX_NAME_LENGTH
from .tiling import Corners, check_corners

#: File name a scene's metadata always has.
METADATA_NAME = "METADATA.DIM"
#: A real one is about 2.5 MB, most of it attitude samples.
MAX_METADATA_BYTES = 16 * 1024 * 1024
# "COPYRIGHT CNES 07 05 2006 02 H 22 MN 12 S": the holder, then the acquisition moment again.
_COPYRIGHT = re.compile(r"^COPYRIGHT\s+(.+?)\s+\d{2} \d{2} (\d{4})\b")
_STAMP = "%Y-%m-%dT%H:%M:%S.%f"
#: A location model must put the corner pixels this close to the frame's corners to be used.
_MODEL_TOLERANCE_DEG = 1e-3

#: ``(row, col)`` of a pixel centre, counted from 1, to ``(lon, lat)``.
Locate = Callable[[float, float], tuple[float, float]]


@dataclass(frozen=True)
class Scene:
    """What a scene's metadata says about showing it on the ground."""

    #: ``lon, lat`` of the top-left, top-right, bottom-right and bottom-left corner pixels.
    corners: Corners
    #: File name of the image, beside the metadata.
    data_file: str
    #: One band to show as grey, or three as red, green and blue.
    bands: tuple[int, ...]
    name: str
    attribution: str
    acquired_at: str | None
    #: The product's own location model, or ``None`` when it has none that fits its corners.
    locate: Locate | None = None


def invalid(detail: str) -> ImageryError:
    """The error every unusable product is rejected with."""
    return ImageryError(
        "imageryProductInvalid",
        f"영상 제품을 읽을 수 없음 · {detail}",
        detail=detail,
    )


def _text(root, path: str) -> str:
    element = root.find(path)
    return (element.text or "").strip() if element is not None else ""


def _frame(root) -> tuple[Corners, tuple[tuple[float, float], ...]]:
    """The corners and the ``(row, col)`` of each, top-left first and clockwise.

    The vertices are ordered by their row and column, not by where they sit in the file.
    """
    placed: dict[tuple[float, float], tuple[float, float]] = {}
    for vertex in root.findall("Dataset_Frame/Vertex"):
        try:
            row, col = float(_text(vertex, "FRAME_ROW")), float(_text(vertex, "FRAME_COL"))
            lon, lat = float(_text(vertex, "FRAME_LON")), float(_text(vertex, "FRAME_LAT"))
        except ValueError as error:
            raise invalid("Dataset_Frame") from error
        placed[(row, col)] = (lon, lat)
    rows, cols = sorted({key[0] for key in placed}), sorted({key[1] for key in placed})
    if len(placed) != 4 or len(rows) != 2 or len(cols) != 2:
        raise invalid("Dataset_Frame")
    order = ((rows[0], cols[0]), (rows[0], cols[1]), (rows[1], cols[1]), (rows[1], cols[0]))
    corners = tuple(value for key in order for value in placed[key])
    try:
        check_corners(corners)
    except ImageryError as error:
        raise invalid("Dataset_Frame") from error
    return corners, order


def _locate(root, corners: Corners, pixels: tuple[tuple[float, float], ...]) -> Locate | None:
    """The simplified direct location model, if it agrees with the frame's corners.

    Its six coefficients per axis multiply ``1, row, col, row*col, row^2, col^2``. A model
    that does not reproduce the corners (another term order, another pixel origin) is left
    out rather than trusted, and the scene is then placed by its corners alone.
    """
    block = root.find(".//Simplified_Location_Model/Direct_Location_Model")
    if block is None:
        return None
    try:
        lon_terms = [float(item.text or "") for item in block.findall("lc_List/lc")]
        lat_terms = [float(item.text or "") for item in block.findall("pc_List/pc")]
    except ValueError:
        return None
    if len(lon_terms) != 6 or len(lat_terms) != 6:
        return None

    def locate(row: float, col: float) -> tuple[float, float]:
        powers = (1.0, row, col, row * col, row * row, col * col)
        lon = sum(term * power for term, power in zip(lon_terms, powers, strict=True))
        lat = sum(term * power for term, power in zip(lat_terms, powers, strict=True))
        return lon, lat

    for (row, col), lon, lat in zip(pixels, corners[0::2], corners[1::2], strict=True):
        found = locate(row, col)
        if max(abs(found[0] - lon), abs(found[1] - lat)) > _MODEL_TOLERANCE_DEG:
            return None
    return locate


def _data_file(root) -> str:
    """The image's file name. Only a bare name is taken: the file must sit beside the metadata."""
    element = root.find("Data_Access/Data_File/DATA_FILE_PATH")
    name = (element.get("href") or "").strip() if element is not None else ""
    plain = name == PurePosixPath(name).name and "\\" not in name and name not in {"", ".", ".."}
    if not plain or not name.lower().endswith((".tif", ".tiff")):
        raise invalid("DATA_FILE_PATH")
    return name


def _bands(root) -> tuple[int, ...]:
    try:
        count = int(_text(root, "Raster_Dimensions/NBANDS"))
        shown = tuple(
            int(_text(root, f"Image_Display/Band_Display_Order/{colour}_CHANNEL"))
            for colour in ("RED", "GREEN", "BLUE")
        )
    except ValueError:
        # No display order: show the first band, as any single-band reader would.
        return (1,)
    if not all(1 <= band <= count for band in shown):
        raise invalid("Band_Display_Order")
    return shown if len(set(shown)) == 3 else (shown[0],)


def _acquired_at(source) -> str | None:
    try:
        moment = datetime.fromisoformat(
            f"{_text(source, 'IMAGING_DATE')}T{_text(source, 'IMAGING_TIME')}"
        )
    except ValueError:
        return None
    return moment.replace(tzinfo=UTC).strftime(_STAMP)[:-3] + "Z"


def _attribution(root) -> str:
    text = _text(root, "Dataset_Id/COPYRIGHT")
    match = _COPYRIGHT.match(text)
    if match:
        text = f"© {match.group(1)} {match.group(2)}"
    return text[:MAX_ATTRIBUTION_LENGTH]


def read_scene(data: bytes) -> Scene:
    """Parse a scene's ``METADATA.DIM``.

    Args:
        data: The file's bytes.

    Returns:
        Where the scene lies, which file and bands hold its picture, and how to label it.

    Raises:
        ImageryError: ``imageryProductInvalid`` when it is not a DIMAP scene description or
            lacks what is needed to place the image.
    """
    if len(data) > MAX_METADATA_BYTES:
        raise invalid(METADATA_NAME)
    try:
        root = parse_xml(data.decode("utf-8"))
    except ValueError as error:
        raise invalid(METADATA_NAME) from error
    if root.tag != "Dimap_Document" or _text(root, "Metadata_Id/METADATA_FORMAT") != "DIMAP":
        raise invalid(METADATA_NAME)
    source = root.find("Dataset_Sources/Source_Information/Scene_Source")
    acquired_at = _acquired_at(source) if source is not None else None
    parts = []
    if source is not None:
        mission = f"{_text(source, 'MISSION')} {_text(source, 'MISSION_INDEX')}".strip()
        instrument = _text(source, "INSTRUMENT") + _text(source, "INSTRUMENT_INDEX")
        parts = [mission, instrument, _text(source, "SENSOR_CODE"), (acquired_at or "")[:10]]
    name = " ".join(part for part in parts if part) or _text(root, "Dataset_Id/DATASET_NAME")
    corners, pixels = _frame(root)
    return Scene(
        corners=corners,
        data_file=_data_file(root),
        bands=_bands(root),
        name=name[:MAX_NAME_LENGTH],
        attribution=_attribution(root),
        acquired_at=acquired_at,
        locate=_locate(root, corners, pixels),
    )
