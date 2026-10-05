"""Reading, checking and writing MBTiles files with the standard library only.

An uploaded MBTiles is an SQLite file from somewhere else, so it is never opened for writing
and only a handful of fixed ``SELECT`` statements ever run against it.
"""

import sqlite3
import struct
import zlib
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from .formats import MEDIA_TYPES, SQLITE_MAGIC, ImageryError, raster_kind
from .limits import MAX_ATTRIBUTION_LENGTH, MAX_MBTILES_ZOOM
from .tiling import TILE_PX, Bounds, tiles_bounds_deg

_ALLOWED_ACTIONS = frozenset({sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION})
_METADATA_ROWS = 64
_SAMPLE_TILES = 4


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def _transparent_png(size: int) -> bytes:
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    rows = (b"\x00" + b"\x00" * 4 * size) * size
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(rows, 9))
        + _png_chunk(b"IEND", b"")
    )


#: Served where a set has no tile, so the globe shows the basemap instead of a load error.
TRANSPARENT_TILE = _transparent_png(TILE_PX)


@dataclass(frozen=True)
class MbtilesInfo:
    """What an MBTiles file holds, read from its tiles rather than trusted from its metadata."""

    min_zoom: int
    max_zoom: int
    tile_count: int
    tile_format: str
    bounds_deg: Bounds
    attribution: str


def tms_row(zoom: int, y: int) -> int:
    """Convert between an XYZ row and the TMS row MBTiles stores; it is its own inverse."""
    return 2**zoom - 1 - y


def tile_media_type(data: bytes) -> str:
    """Content type of tile bytes, from their signature."""
    return MEDIA_TYPES.get(raster_kind(data) or "", "application/octet-stream")


def _authorize(action: int, *_details: object) -> int:
    return sqlite3.SQLITE_OK if action in _ALLOWED_ACTIONS else sqlite3.SQLITE_DENY


def open_readonly(path: Path) -> sqlite3.Connection:
    """Open an MBTiles file so that nothing but plain reads can run against it."""
    db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True, timeout=5)
    try:
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA query_only=ON")
        db.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        db.set_authorizer(_authorize)
    except sqlite3.Error:
        db.close()
        raise
    return db


def _invalid() -> ImageryError:
    return ImageryError(
        "imageryMbtilesInvalid", "MBTiles 파일을 읽을 수 없음 · tiles 테이블 확인 필요"
    )


def _metadata(db: sqlite3.Connection) -> dict[str, str]:
    """The optional ``metadata`` table; a file without one is still usable."""
    try:
        rows = db.execute("SELECT name, value FROM metadata LIMIT ?", (_METADATA_ROWS,)).fetchall()
    except sqlite3.Error:
        return {}
    return {name: value for name, value in rows if isinstance(name, str) and isinstance(value, str)}


def _declared_bounds(metadata: dict[str, str], extent: Bounds) -> Bounds:
    """``metadata.bounds`` when it is a real box inside the tiles, else the tile extent.

    The declared box is usually tighter than the tiles, whose edges fall on tile boundaries.
    """
    try:
        west, south, east, north = (float(part) for part in metadata["bounds"].split(","))
    except (KeyError, ValueError):
        return extent
    slack = 1e-6
    inside = (
        extent[0] - slack <= west < east <= extent[2] + slack
        and extent[1] - slack <= south < north <= extent[3] + slack
    )
    return (west, south, east, north) if inside else extent


def inspect(path: Path) -> MbtilesInfo:
    """Check that a file is a raster MBTiles and describe it.

    Raises:
        ImageryError: ``imageryMbtilesInvalid`` when it is not a usable MBTiles file, or
            ``imageryMbtilesNotRaster`` when its tiles are not PNG, JPEG or WebP images.
    """
    with path.open("rb") as source:
        if source.read(len(SQLITE_MAGIC)) != SQLITE_MAGIC:
            raise _invalid()
    try:
        with closing(open_readonly(path)) as db:
            low, high, count = db.execute(
                "SELECT MIN(zoom_level), MAX(zoom_level), COUNT(*) FROM tiles"
            ).fetchone()
            if not (isinstance(low, int) and isinstance(high, int) and count):
                raise _invalid()
            if not 0 <= low <= high <= MAX_MBTILES_ZOOM:
                raise _invalid()
            extent = db.execute(
                "SELECT MIN(tile_column), MAX(tile_column), MIN(tile_row), MAX(tile_row) "
                "FROM tiles WHERE zoom_level = ?",
                (high,),
            ).fetchone()
            if not all(isinstance(value, int) and 0 <= value < 2**high for value in extent):
                raise _invalid()
            samples = [
                row[0]
                for zoom in {low, high}
                for row in db.execute(
                    "SELECT tile_data FROM tiles WHERE zoom_level = ? LIMIT ?",
                    (zoom, _SAMPLE_TILES),
                )
            ]
            metadata = _metadata(db)
    except sqlite3.Error as error:
        raise _invalid() from error
    kinds = {raster_kind(tile) if isinstance(tile, bytes) else None for tile in samples}
    if None in kinds:
        raise ImageryError(
            "imageryMbtilesNotRaster", "래스터 타일(PNG·JPEG·WebP)이 든 MBTiles만 사용 가능"
        )
    x0, x1, row0, row1 = extent
    # TMS rows grow northward, so the highest row is the northern edge.
    tiles = tiles_bounds_deg(high, x0, tms_row(high, row1), x1, tms_row(high, row0))
    return MbtilesInfo(
        min_zoom=low,
        max_zoom=high,
        tile_count=count,
        tile_format=kinds.pop() if len(kinds) == 1 else "mixed",
        bounds_deg=_declared_bounds(metadata, tiles),
        attribution=metadata.get("attribution", "").strip()[:MAX_ATTRIBUTION_LENGTH],
    )


def read_tile(path: Path, zoom: int, x: int, y: int) -> bytes | None:
    """Tile bytes for an XYZ address, or ``None`` when the file has no such tile."""
    try:
        with closing(open_readonly(path)) as db:
            row = db.execute(
                "SELECT tile_data FROM tiles "
                "WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                (zoom, x, tms_row(zoom, y)),
            ).fetchone()
    except sqlite3.Error:
        return None
    return row[0] if row and isinstance(row[0], bytes) else None


class MbtilesWriter:
    """Writes a new MBTiles file; used for the sets SODA cuts itself."""

    _COMMIT_EVERY = 256

    def __init__(self, path: Path) -> None:
        self._db = sqlite3.connect(path)
        self._db.executescript(
            "CREATE TABLE metadata (name TEXT, value TEXT);"
            "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER,"
            " tile_data BLOB);"
            "CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);"
        )
        self.count = 0

    def add(self, zoom: int, x: int, y: int, data: bytes) -> None:
        """Store one XYZ tile."""
        self._db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (zoom, x, tms_row(zoom, y), data))
        self.count += 1
        if self.count % self._COMMIT_EVERY == 0:
            self._db.commit()

    def finish(self, metadata: dict[str, str]) -> None:
        """Write the metadata table and close the file."""
        self._db.executemany("INSERT INTO metadata VALUES (?, ?)", list(metadata.items()))
        self._db.commit()
        self._db.close()

    def abort(self) -> None:
        """Close the file without finishing it; the caller removes it."""
        self._db.close()
