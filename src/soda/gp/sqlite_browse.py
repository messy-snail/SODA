"""Read-only table browsing and file backup for the SQLite store.

Kept apart from ``sqlite_store`` so the repository stays focused on the typed records the
app works with; this module only shows the raw rows to the settings screen.
"""

import contextlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from .store import BrowsePage, TableInfo

#: Browsable tables: ``(order by, columns a search matches)``. Nothing else is reachable,
#: which also keeps the table name out of reach of SQL injection.
TABLES: dict[str, tuple[str, tuple[str, ...]]] = {
    "gp_latest": ("norad_id", ("CAST(norad_id AS TEXT)", "name", "object_id")),
    "gp_history": ("norad_id, epoch DESC", ("CAST(norad_id AS TEXT)",)),
    "group_members": ("group_name, norad_id", ("group_name", "CAST(norad_id AS TEXT)")),
    "fetch_log": ("last_attempt_at DESC", ("source", "key", "last_status")),
    "stations": ("id", ("name", "preset_id")),
    "sensor_presets": ("id", ("name",)),
    "custom_elements": ("id", ("name",)),
    "custom_states": ("id", ("name",)),
    "custom_ephemerides": ("id", ("name",)),
}

#: Binary columns, shown as their size in bytes instead of being read out.
BLOB_COLUMNS = frozenset({"samples"})

#: Columns stored as JSON text; they are returned parsed.
JSON_COLUMNS = frozenset({"omm", "az_mask", "state", "meta"})

MAX_PAGE = 200


class UnknownTable(KeyError):
    """Raised by ``browse`` for a table outside ``TABLES``."""


def _select_list(db: sqlite3.Connection, table: str) -> tuple[tuple[str, str], ...]:
    """``(expression, shown name)`` for each column of a table."""
    names = [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
    return tuple(
        (f"length({name})", f"{name}_bytes") if name in BLOB_COLUMNS else (name, name)
        for name in names
    )


def _columns(db: sqlite3.Connection, table: str) -> tuple[str, ...]:
    return tuple(shown for _, shown in _select_list(db, table))


def list_tables(db: sqlite3.Connection) -> list[TableInfo]:
    """Every browsable table with its columns and row count."""
    return [
        TableInfo(
            name=table,
            columns=_columns(db, table),
            count=db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0],
        )
        for table in TABLES
    ]


def _decode(column: str, value: Any) -> Any:
    if column in JSON_COLUMNS and isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def browse(
    db: sqlite3.Connection, table: str, offset: int = 0, limit: int = 50, query: str = ""
) -> BrowsePage:
    """One page of a table's rows.

    Args:
        db: Open connection.
        table: One of ``TABLES``.
        offset: Rows to skip.
        limit: Page size, clamped to ``1..MAX_PAGE``.
        query: Case-insensitive substring matched against the table's search columns.

    Returns:
        The page, with JSON columns parsed and the total count after filtering.

    Raises:
        UnknownTable: ``table`` is not browsable.
    """
    if table not in TABLES:
        raise UnknownTable(table)
    order, searchable = TABLES[table]
    limit = max(1, min(limit, MAX_PAGE))
    where, params = "", []
    if query.strip():
        pattern = f"%{query.strip()}%"
        where = "WHERE " + " OR ".join(f"{column} LIKE ?" for column in searchable)
        params = [pattern] * len(searchable)
    total = db.execute(f"SELECT COUNT(*) FROM {table} {where}", params).fetchone()[0]
    selected = ", ".join(f"{sql} AS {shown}" for sql, shown in _select_list(db, table))
    cursor = db.execute(
        f"SELECT {selected} FROM {table} {where} ORDER BY {order} LIMIT ? OFFSET ?",
        [*params, limit, max(0, offset)],
    )
    columns = tuple(item[0] for item in cursor.description)
    rows = [
        {column: _decode(column, value) for column, value in zip(columns, row, strict=True)}
        for row in cursor.fetchall()
    ]
    return BrowsePage(table=table, columns=columns, rows=rows, total=total)


def backup(db: sqlite3.Connection, target: Path) -> None:
    """Write a consistent copy of the whole database to ``target``, even while it is in use."""
    with contextlib.closing(sqlite3.connect(target)) as copy:
        db.backup(copy)
