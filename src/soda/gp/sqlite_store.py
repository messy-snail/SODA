"""SQLite implementation of :class:`~soda.gp.store.Store`, the default backend."""

import contextlib
import json
import os
import sqlite3
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from . import sqlite_browse
from .classify import CATEGORY_SQL
from .models import ElementSet, parse_epoch
from .sqlite_custom import CUSTOM_SCHEMA, CustomSourcesMixin
from .store import (
    SODA_TABLES,
    BrowsePage,
    FetchRecord,
    ProbeResult,
    SensorPreset,
    SensorPresetNameTaken,
    Station,
    StationNameTaken,
    TableInfo,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS gp_latest (
    norad_id INTEGER PRIMARY KEY,
    epoch TEXT NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    object_id TEXT NOT NULL,
    omm TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gp_latest_name ON gp_latest (name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS gp_history (
    norad_id INTEGER NOT NULL,
    epoch TEXT NOT NULL,
    source TEXT NOT NULL,
    omm TEXT NOT NULL,
    PRIMARY KEY (norad_id, epoch)
);
CREATE TABLE IF NOT EXISTS group_members (
    group_name TEXT NOT NULL,
    norad_id INTEGER NOT NULL,
    PRIMARY KEY (group_name, norad_id)
);
CREATE TABLE IF NOT EXISTS fetch_log (
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    last_ok_at TEXT,
    last_status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    object_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, key)
);
CREATE TABLE IF NOT EXISTS stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    lat_deg REAL NOT NULL,
    lon_deg REAL NOT NULL,
    alt_m REAL NOT NULL DEFAULT 0,
    min_elev_deg REAL NOT NULL DEFAULT 10,
    preset_id TEXT,
    az_mask TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sensor_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL,
    swath_km REAL NOT NULL,
    fov_deg REAL NOT NULL,
    max_off_nadir_deg REAL NOT NULL,
    min_sun_elev_deg REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_elements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    omm TEXT NOT NULL,
    input_format TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

#: Columns added to ``stations`` after the first release. ``SCHEMA`` above already carries
#: them for a fresh database; ``_add_missing_columns`` brings an existing one along, because
#: dropping ``data/soda.db`` to re-create it is not an option.
STATION_COLUMNS: tuple[tuple[str, str], ...] = (
    ("preset_id", "TEXT"),
    ("az_mask", "TEXT NOT NULL DEFAULT '[]'"),
)

#: Seeded only into an empty database, so a first run has something to predict against.
#: The coordinate is sourced; see ``frontend/src/stations/SOURCES.md`` for ``kari-naro``.
#: ``preset_id`` is what lets the frontend show the name in the reader's language.
DEFAULT_STATIONS = (("나로우주센터", 34.4319, 127.5351, 0.0, 5.0, "kari-naro", "[]"),)


def _iso(value: datetime) -> str:
    """Fixed-width UTC timestamp so SQL string comparison matches time order."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _element(row: sqlite3.Row) -> ElementSet:
    omm = json.loads(row["omm"])
    return ElementSet(
        norad_id=row["norad_id"],
        name=omm["OBJECT_NAME"],
        object_id=omm["OBJECT_ID"],
        epoch=parse_epoch(row["epoch"]),
        source=row["source"],
        omm=omm,
    )


def _station(row: sqlite3.Row) -> Station:
    fields = dict(row)
    mask = json.loads(fields.pop("az_mask", None) or "[]")
    return Station(**fields, az_mask=tuple((float(az), float(elev)) for az, elev in mask))


def _add_missing_columns(
    db: sqlite3.Connection, table: str, columns: tuple[tuple[str, str], ...]
) -> None:
    """Additive migration. Existing rows keep their values and take the column default."""
    existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
    for name, ddl in columns:
        if name not in existing:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def _fetch_record(row: sqlite3.Row) -> FetchRecord:
    return FetchRecord(
        source=row["source"],
        key=row["key"],
        last_attempt_at=parse_epoch(row["last_attempt_at"]),
        last_ok_at=parse_epoch(row["last_ok_at"]) if row["last_ok_at"] else None,
        last_status=row["last_status"],
        detail=row["detail"],
        consecutive_errors=row["consecutive_errors"],
        object_count=row["object_count"],
    )


def probe_sqlite(path: Path) -> ProbeResult:
    """``probe_store`` for SQLite: look at ``path`` read-only and never create it."""
    if path.is_dir():
        return ProbeResult("sqlite", path, False, False, False, "path is a directory")
    if not path.exists():
        parent = next((p for p in (path.parent, *path.parent.parents) if p.exists()), None)
        if parent is None or not parent.is_dir() or not os.access(parent, os.W_OK):
            return ProbeResult("sqlite", path, False, False, False, "directory is not writable")
        return ProbeResult("sqlite", path, False, False, True)
    try:
        uri = f"{path.resolve().as_uri()}?mode=ro"
        with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
            rows = db.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    except sqlite3.DatabaseError as error:
        return ProbeResult("sqlite", path, True, False, False, f"not a SQLite database: {error}")
    tables = {row[0] for row in rows}
    ours = bool(tables & SODA_TABLES)
    if tables and not ours:
        return ProbeResult("sqlite", path, True, False, False, "holds another application's tables")
    if not os.access(path, os.W_OK):
        return ProbeResult("sqlite", path, True, ours, False, "file is read-only")
    return ProbeResult("sqlite", path, True, ours, True)


class SqliteStore(CustomSourcesMixin):
    """Thin synchronous repository. Each call opens a short-lived connection."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(SCHEMA + CUSTOM_SCHEMA)
            _add_missing_columns(db, "stations", STATION_COLUMNS)
            if db.execute("SELECT COUNT(*) FROM stations").fetchone()[0] == 0:
                db.executemany(
                    "INSERT INTO stations (name, lat_deg, lon_deg, alt_m, min_elev_deg, "
                    "preset_id, az_mask) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    DEFAULT_STATIONS,
                )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA journal_mode=WAL")
            with db:
                yield db
        finally:
            db.close()

    # Element sets -------------------------------------------------------------------------

    def upsert_latest(self, elements: Iterable[ElementSet], now: datetime) -> int:
        """Insert element sets, keeping only the newest epoch per object."""
        rows = [
            (e.norad_id, _iso(e.epoch), e.source, e.name, e.object_id, json.dumps(e.omm), _iso(now))
            for e in elements
        ]
        with self._connect() as db:
            db.executemany(
                """
                INSERT INTO gp_latest (norad_id, epoch, source, name, object_id, omm, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (norad_id) DO UPDATE SET
                    epoch = excluded.epoch, source = excluded.source, name = excluded.name,
                    object_id = excluded.object_id, omm = excluded.omm,
                    updated_at = excluded.updated_at
                WHERE excluded.epoch >= gp_latest.epoch
                """,
                rows,
            )
        return len(rows)

    def latest(self, norad_id: int) -> ElementSet | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM gp_latest WHERE norad_id = ?", (norad_id,)).fetchone()
        return _element(row) if row else None

    def search(
        self,
        query: str,
        group: str | None,
        limit: int,
        category: Sequence[str] | None = None,
    ) -> list[ElementSet]:
        """Find objects by NORAD ID prefix or case-insensitive name fragment.

        Args:
            query: Name fragment or NORAD ID prefix; empty matches everything.
            group: Only members of this CelesTrak group, when given.
            limit: Maximum number of results.
            category: Only objects ``classify`` puts in one of these categories, filtered
                before ``LIMIT`` so a short page means there are no more. Empty means all.

        Returns:
            Matches, exact NORAD ID first, then shorter names first.
        """
        text = query.strip()
        clauses, params = [], []
        if text:
            clauses.append("(name LIKE ? COLLATE NOCASE OR CAST(norad_id AS TEXT) LIKE ?)")
            params += [f"%{text}%", f"{text}%"]
        if group:
            clauses.append("norad_id IN (SELECT norad_id FROM group_members WHERE group_name = ?)")
            params.append(group)
        if isinstance(category, str):
            category = (category,)
        if category:
            clauses.append(f"({CATEGORY_SQL}) IN ({', '.join('?' * len(category))})")
            params += list(category)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        order = "CASE WHEN CAST(norad_id AS TEXT) = ? THEN 0 ELSE 1 END, length(name), name"
        with self._connect() as db:
            rows = db.execute(
                f"SELECT * FROM gp_latest {where} ORDER BY {order} LIMIT ?",
                [*params, text, limit],
            ).fetchall()
        return [_element(row) for row in rows]

    def group_elements(self, group: str) -> list[ElementSet]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT g.* FROM gp_latest g JOIN group_members m ON m.norad_id = g.norad_id "
                "WHERE m.group_name = ? ORDER BY g.norad_id",
                (group,),
            ).fetchall()
        return [_element(row) for row in rows]

    def replace_group(self, group: str, norad_ids: Iterable[int]) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM group_members WHERE group_name = ?", (group,))
            db.executemany(
                "INSERT OR IGNORE INTO group_members (group_name, norad_id) VALUES (?, ?)",
                [(group, norad_id) for norad_id in norad_ids],
            )

    def groups_of(self, norad_id: int) -> list[str]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT group_name FROM group_members WHERE norad_id = ?", (norad_id,)
            ).fetchall()
        return [row[0] for row in rows]

    def group_counts(self) -> dict[str, int]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT group_name, COUNT(*) FROM group_members GROUP BY group_name"
            ).fetchall()
        return {row[0]: row[1] for row in rows}

    def count_latest(self) -> int:
        with self._connect() as db:
            return db.execute("SELECT COUNT(*) FROM gp_latest").fetchone()[0]

    def add_history(self, elements: Iterable[ElementSet]) -> None:
        rows = [(e.norad_id, _iso(e.epoch), e.source, json.dumps(e.omm)) for e in elements]
        with self._connect() as db:
            db.executemany(
                "INSERT OR REPLACE INTO gp_history (norad_id, epoch, source, omm) "
                "VALUES (?, ?, ?, ?)",
                rows,
            )

    def history_near(self, norad_id: int, start: datetime, end: datetime) -> list[ElementSet]:
        """Return historical element sets whose epochs fall inside ``[start, end]``."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM gp_history WHERE norad_id = ? AND epoch BETWEEN ? AND ? "
                "ORDER BY epoch",
                (norad_id, _iso(start), _iso(end)),
            ).fetchall()
        return [_element(row) for row in rows]

    # Fetch bookkeeping --------------------------------------------------------------------

    def fetch_record(self, source: str, key: str) -> FetchRecord | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM fetch_log WHERE source = ? AND key = ?", (source, key)
            ).fetchone()
        return _fetch_record(row) if row else None

    def record_fetch(
        self,
        source: str,
        key: str,
        *,
        at: datetime,
        status: str,
        ok: bool,
        detail: str = "",
        object_count: int | None = None,
    ) -> None:
        """Record one upstream request so rate rules survive restarts."""
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO fetch_log (source, key, last_attempt_at, last_ok_at, last_status,
                                       detail, consecutive_errors, object_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (source, key) DO UPDATE SET
                    last_attempt_at = excluded.last_attempt_at,
                    last_ok_at = COALESCE(excluded.last_ok_at, fetch_log.last_ok_at),
                    last_status = excluded.last_status,
                    detail = excluded.detail,
                    consecutive_errors = CASE WHEN ? THEN 0
                                              ELSE fetch_log.consecutive_errors + 1 END,
                    object_count = COALESCE(?, fetch_log.object_count)
                """,
                (
                    source,
                    key,
                    _iso(at),
                    _iso(at) if ok else None,
                    status,
                    detail,
                    0 if ok else 1,
                    object_count or 0,
                    ok,
                    object_count,
                ),
            )

    def fetch_records(self) -> list[FetchRecord]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM fetch_log ORDER BY source, key").fetchall()
        return [_fetch_record(row) for row in rows]

    # Stations -----------------------------------------------------------------------------

    def stations(self) -> list[Station]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM stations ORDER BY id").fetchall()
        return [_station(row) for row in rows]

    def station(self, station_id: int) -> Station | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM stations WHERE id = ?", (station_id,)).fetchone()
        return _station(row) if row else None

    def add_station(
        self,
        name: str,
        lat_deg: float,
        lon_deg: float,
        alt_m: float,
        min_elev_deg: float,
        preset_id: str | None = None,
        az_mask: Sequence[Sequence[float]] = (),
    ) -> Station:
        try:
            with self._connect() as db:
                cursor = db.execute(
                    "INSERT INTO stations (name, lat_deg, lon_deg, alt_m, min_elev_deg, "
                    "preset_id, az_mask) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (name, lat_deg, lon_deg, alt_m, min_elev_deg, preset_id, json.dumps(az_mask)),
                )
                station_id = cursor.lastrowid
        except sqlite3.IntegrityError as error:
            raise StationNameTaken(name) from error
        station = self.station(int(station_id or 0))
        assert station is not None
        return station

    def update_station(
        self,
        station_id: int,
        name: str,
        lat_deg: float,
        lon_deg: float,
        alt_m: float,
        min_elev_deg: float,
        preset_id: str | None = None,
        az_mask: Sequence[Sequence[float]] = (),
    ) -> Station | None:
        """Replace a station in place so its id, and the colour bound to it, survive edits."""
        try:
            with self._connect() as db:
                changed = db.execute(
                    "UPDATE stations SET name = ?, lat_deg = ?, lon_deg = ?, alt_m = ?, "
                    "min_elev_deg = ?, preset_id = ?, az_mask = ? WHERE id = ?",
                    (
                        name,
                        lat_deg,
                        lon_deg,
                        alt_m,
                        min_elev_deg,
                        preset_id,
                        json.dumps(az_mask),
                        station_id,
                    ),
                ).rowcount
        except sqlite3.IntegrityError as error:
            raise StationNameTaken(name) from error
        return self.station(station_id) if changed else None

    def delete_station(self, station_id: int) -> bool:
        with self._connect() as db:
            return db.execute("DELETE FROM stations WHERE id = ?", (station_id,)).rowcount > 0

    # Sensor presets -----------------------------------------------------------------------

    def sensor_presets(self) -> list[SensorPreset]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM sensor_presets ORDER BY id").fetchall()
        return [SensorPreset(**dict(row)) for row in rows]

    def sensor_preset(self, preset_id: int) -> SensorPreset | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM sensor_presets WHERE id = ?", (preset_id,)).fetchone()
        return SensorPreset(**dict(row)) if row else None

    def add_sensor_preset(
        self,
        name: str,
        mode: str,
        swath_km: float,
        fov_deg: float,
        max_off_nadir_deg: float,
        min_sun_elev_deg: float,
    ) -> SensorPreset:
        try:
            with self._connect() as db:
                cursor = db.execute(
                    "INSERT INTO sensor_presets (name, mode, swath_km, fov_deg, "
                    "max_off_nadir_deg, min_sun_elev_deg) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, mode, swath_km, fov_deg, max_off_nadir_deg, min_sun_elev_deg),
                )
                preset_id = cursor.lastrowid
        except sqlite3.IntegrityError as error:
            raise SensorPresetNameTaken(name) from error
        preset = self.sensor_preset(int(preset_id or 0))
        assert preset is not None
        return preset

    def update_sensor_preset(
        self,
        preset_id: int,
        name: str,
        mode: str,
        swath_km: float,
        fov_deg: float,
        max_off_nadir_deg: float,
        min_sun_elev_deg: float,
    ) -> SensorPreset | None:
        try:
            with self._connect() as db:
                changed = db.execute(
                    "UPDATE sensor_presets SET name = ?, mode = ?, swath_km = ?, fov_deg = ?, "
                    "max_off_nadir_deg = ?, min_sun_elev_deg = ? WHERE id = ?",
                    (
                        name,
                        mode,
                        swath_km,
                        fov_deg,
                        max_off_nadir_deg,
                        min_sun_elev_deg,
                        preset_id,
                    ),
                ).rowcount
        except sqlite3.IntegrityError as error:
            raise SensorPresetNameTaken(name) from error
        return self.sensor_preset(preset_id) if changed else None

    def delete_sensor_preset(self, preset_id: int) -> bool:
        with self._connect() as db:
            cursor = db.execute("DELETE FROM sensor_presets WHERE id = ?", (preset_id,))
            return cursor.rowcount > 0

    # Housekeeping -------------------------------------------------------------------------

    def stats(self) -> dict[str, int]:
        with self._connect() as db:
            return {
                name: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for name, table in (
                    ("objects", "gp_latest"),
                    ("history", "gp_history"),
                    ("stations", "stations"),
                    ("sensor_presets", "sensor_presets"),
                    ("custom_elements", "custom_elements"),
                    ("fetches", "fetch_log"),
                )
            }

    def tables(self) -> list[TableInfo]:
        with self._connect() as db:
            return sqlite_browse.list_tables(db)

    def browse(self, table: str, offset: int, limit: int, query: str) -> BrowsePage:
        with self._connect() as db:
            return sqlite_browse.browse(db, table, offset, limit, query)

    def backup_to(self, target: Path) -> None:
        with self._connect() as db:
            sqlite_browse.backup(db, target)
