import json
import shutil
import sqlite3
import struct
import zlib
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from soda.app import create_app
from soda.settings import Settings

FIXTURES = Path(__file__).parent / "fixtures"
EPHEMERIS = Path(__file__).parents[1] / "data" / "ephemeris" / "de421.bsp"


@pytest.fixture
def iss_record() -> dict:
    """CelesTrak OMM JSON for the ISS (epoch 2026-09-15T21:14:23Z)."""
    return json.loads((FIXTURES / "omm_iss.json").read_text())[0]


@pytest.fixture(scope="session")
def ephemeris_file() -> Path:
    if not EPHEMERIS.is_file():
        pytest.skip("data/ephemeris/de421.bsp is not downloaded")
    return EPHEMERIS


@pytest.fixture
def data_dir(tmp_path: Path, ephemeris_file: Path) -> Path:
    """Temporary data directory that already contains the ephemeris."""
    target = tmp_path / "ephemeris" / ephemeris_file.name
    target.parent.mkdir(parents=True)
    try:
        target.hardlink_to(ephemeris_file)
    except OSError:
        shutil.copy(ephemeris_file, target)
    return tmp_path


def _build_glb(document: dict) -> bytes:
    payload = json.dumps(document).encode()
    payload += b" " * (-len(payload) % 4)
    header = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(payload))
    return header + struct.pack("<II", len(payload), 0x4E4F534A) + payload


@pytest.fixture
def make_glb():
    """Builder for minimal GLB files whose JSON chunk is the given glTF document."""
    return _build_glb


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def _build_png(width: int = 2, height: int = 1) -> bytes:
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    pixels = b"".join(b"\x00" + b"\xff\x00\x00\xff" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(pixels))
        + _png_chunk(b"IEND", b"")
    )


@pytest.fixture
def make_png():
    """Builder for small, valid RGBA PNG files of the given size."""
    return _build_png


# Top-left, top-right, bottom-right, bottom-left of a tilted footprint west of Seoul.
SCENE_QUAD = (126.0, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95)


def scene_model(
    size: int, quad: tuple[float, ...] = SCENE_QUAD, bow_deg: float = 0.0
) -> tuple[list[float], list[float]]:
    """Coefficients of a location model that passes through the corners of ``quad``.

    They multiply ``1, row, col, row*col, row^2, col^2`` with rows and columns counted from 1,
    for longitude and for latitude. ``bow_deg`` pushes the middle columns that far south,
    leaving the left and right edges where they are.
    """
    span = size - 1
    both = []
    for (top_left, top_right, bottom_right, bottom_left), bow in (
        (quad[0::2], 0.0),
        (quad[1::2], bow_deg),
    ):
        twist = (top_left - top_right + bottom_right - bottom_left) / span**2
        along_row = (bottom_left - top_left) / span - twist
        along_col = (top_right - top_left) / span - twist
        constant = top_left - along_row - along_col - twist
        # bend * (col - 1) * (col - size) is zero on both edges and -bow in the middle.
        bend = 4 * bow / span**2
        both.append(
            [constant + bend * size, along_row, along_col - bend * (size + 1), twist, 0.0, bend]
        )
    return both[0], both[1]


def _build_dim(
    size: int = 64,
    *,
    quad: tuple[float, ...] = SCENE_QUAD,
    order: tuple[int, ...] = (0, 1, 2, 3),
    href: str = "IMAGERY.TIF",
    bands: int = 1,
    display: tuple[int, int, int] = (1, 1, 1),
    head: str = "",
    model: tuple[list[float], list[float]] | None = None,
) -> bytes:
    """A DIMAP 1.1 scene description with only the blocks SODA reads.

    Args:
        size: Rows and columns of the image.
        quad: Ground corners, top-left first and clockwise.
        order: Order the four vertices are written in.
        href: Image file the metadata points at.
        bands: Band count.
        display: Bands shown as red, green and blue.
        head: Text put before the document element.
        model: Longitude and latitude coefficients of a simplified location model.
    """
    pixels = ((1, 1), (1, size), (size, size), (size, 1))
    vertices = "".join(
        f"<Vertex><FRAME_LON>{quad[2 * i]}</FRAME_LON><FRAME_LAT>{quad[2 * i + 1]}</FRAME_LAT>"
        f"<FRAME_ROW>{pixels[i][0]}</FRAME_ROW><FRAME_COL>{pixels[i][1]}</FRAME_COL></Vertex>"
        for i in order
    )
    red, green, blue = display
    location = ""
    if model is not None:
        lon_terms = "".join(f"<lc>{value!r}</lc>" for value in model[0])
        lat_terms = "".join(f"<pc>{value!r}</pc>" for value in model[1])
        location = (
            "<Data_Strip><Models><Simplified_Location_Model><Direct_Location_Model>"
            f"<lc_List>{lon_terms}</lc_List><pc_List>{lat_terms}</pc_List>"
            "</Direct_Location_Model></Simplified_Location_Model></Models></Data_Strip>"
        )
    return (
        f"<?xml version='1.0' encoding='UTF-8'?>{head}"
        "<Dimap_Document name='METADATA.DIM'>"
        "<Metadata_Id><METADATA_FORMAT version='1.1'>DIMAP</METADATA_FORMAT>"
        "<METADATA_PROFILE>SPOTSCENE_1A</METADATA_PROFILE></Metadata_Id>"
        "<Dataset_Id><DATASET_NAME>SCENE 5 303-275 06/05/07 02:22:12 1 A</DATASET_NAME>"
        "<COPYRIGHT>COPYRIGHT CNES 07 05 2006 02 H 22 MN 12 S</COPYRIGHT></Dataset_Id>"
        f"<Dataset_Frame>{vertices}<Scene_Center><FRAME_LON>126.5</FRAME_LON>"
        "<FRAME_LAT>37.3</FRAME_LAT><FRAME_ROW>33</FRAME_ROW><FRAME_COL>33</FRAME_COL>"
        "</Scene_Center></Dataset_Frame>"
        f"<Raster_Dimensions><NCOLS>{size}</NCOLS><NROWS>{size}</NROWS>"
        f"<NBANDS>{bands}</NBANDS></Raster_Dimensions>"
        f"<Data_Access><Data_File><DATA_FILE_PATH href='{href}'/></Data_File></Data_Access>"
        f"<Image_Display><Band_Display_Order><RED_CHANNEL>{red}</RED_CHANNEL>"
        f"<GREEN_CHANNEL>{green}</GREEN_CHANNEL><BLUE_CHANNEL>{blue}</BLUE_CHANNEL>"
        "</Band_Display_Order></Image_Display>"
        "<Dataset_Sources><Source_Information><Scene_Source>"
        "<IMAGING_DATE>2006-05-07</IMAGING_DATE><IMAGING_TIME>02:22:12</IMAGING_TIME>"
        "<MISSION>SPOT</MISSION><MISSION_INDEX>5</MISSION_INDEX><INSTRUMENT>HRG</INSTRUMENT>"
        "<INSTRUMENT_INDEX>1</INSTRUMENT_INDEX><SENSOR_CODE>A</SENSOR_CODE>"
        "</Scene_Source></Source_Information></Dataset_Sources>"
        f"{location}</Dimap_Document>"
    ).encode()


@pytest.fixture
def make_dim():
    """Builder for the ``METADATA.DIM`` of a SPOT scene product."""
    return _build_dim


def _build_mbtiles(path: Path, tiles: dict[tuple[int, int, int], bytes], **metadata: str) -> Path:
    """Write an MBTiles file from XYZ-addressed tiles (rows are flipped to TMS as the spec says)."""
    db = sqlite3.connect(path)
    db.executescript(
        "CREATE TABLE metadata (name TEXT, value TEXT);"
        "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER,"
        " tile_data BLOB);"
    )
    db.executemany("INSERT INTO metadata VALUES (?, ?)", list(metadata.items()))
    db.executemany(
        "INSERT INTO tiles VALUES (?, ?, ?, ?)",
        [(z, x, 2**z - 1 - y, data) for (z, x, y), data in tiles.items()],
    )
    db.commit()
    db.close()
    return path


@pytest.fixture
def make_mbtiles():
    """Builder for small MBTiles files: ``make_mbtiles(path, {(z, x, y): bytes}, name=...)``."""
    return _build_mbtiles


@pytest.fixture
def upstream_requests():
    return []


@pytest.fixture
def client(data_dir, tmp_path, builtin_logos, iss_record, upstream_requests):
    def handler(request: httpx.Request) -> httpx.Response:
        upstream_requests.append(request)
        if request.url.params.get("GROUP") == "stations":
            return httpx.Response(200, json=[iss_record])
        if request.url.params.get("CATNR") == "25544":
            return httpx.Response(200, json=[iss_record])
        return httpx.Response(200, text="No GP data found")

    settings = Settings(
        data_dir=data_dir,
        auto_refresh=False,
        builtin_logos_dir=builtin_logos,
        imagery_inbox=False,
        source_path=tmp_path / "settings.local.toml",
    )
    app = create_app(settings, transport=httpx.MockTransport(handler), static=tmp_path / "none")
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def builtin_logos(tmp_path):
    """Stand-in for the logos bundled with the package, so tests never read the real ones."""
    return tmp_path / "builtin-logos"


@pytest.fixture
def bare_client(tmp_path, builtin_logos, monkeypatch):
    """API client that needs neither the ephemeris nor upstream data."""

    def no_ephemeris(directory):
        raise OSError("de421.bsp is not available in this test")

    # Without this the first request that wants the Sun would download the ephemeris.
    monkeypatch.setattr("soda.api.orbit.planets", no_ephemeris)
    settings = Settings(
        data_dir=tmp_path,
        auto_refresh=False,
        builtin_logos_dir=builtin_logos,
        imagery_inbox=False,
        source_path=tmp_path / "settings.local.toml",
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    app = create_app(settings, transport=transport, static=tmp_path / "none")
    with TestClient(app) as test_client:
        yield test_client


def one_satellite(body: dict) -> dict:
    """A ``/passes`` request for one satellite, written the way single-satellite tests think.

    ``norad_id``/``custom_id``, ``start`` and ``end`` move into ``satellites[0]``.
    """
    keys = ("norad_id", "custom_id", "start", "end")
    satellite = {key: body[key] for key in keys if key in body}
    rest = {key: value for key, value in body.items() if key not in keys}
    return {"satellites": [satellite], **rest}
