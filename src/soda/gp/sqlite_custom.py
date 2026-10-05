"""SQLite storage for what the user brings in: orbital elements and state vectors.

A mixin of :class:`~soda.gp.sqlite_store.SqliteStore`, kept apart so that file stays
readable; it relies only on the store's ``_connect``.
"""

import json
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from typing import Any

from .sources import (
    CustomEphemeris,
    CustomEphemerisNameTaken,
    CustomState,
    CustomStateNameTaken,
)
from .store import CustomElementNameTaken, CustomElements

#: Tables of the sources that are not mean elements; created next to the main schema.
CUSTOM_SCHEMA = """
CREATE TABLE IF NOT EXISTS custom_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    epoch TEXT NOT NULL,
    frame TEXT NOT NULL,
    state TEXT NOT NULL,
    input_format TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_ephemerides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    meta TEXT NOT NULL,
    start TEXT NOT NULL,
    stop TEXT NOT NULL,
    sample_count INTEGER NOT NULL,
    samples BLOB NOT NULL,
    created_at TEXT NOT NULL
);
"""

#: Everything but the samples, which a listing has no use for.
_EPHEMERIS_COLUMNS = "id, name, meta, start, stop, sample_count, created_at"

_INSERT_ELEMENTS = (
    "INSERT INTO custom_elements (name, omm, input_format, created_at) VALUES (?, ?, ?, ?)"
)


def _now() -> str:
    """Fixed-width UTC timestamp, the same form the rest of the store writes."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _custom(row: sqlite3.Row) -> CustomElements:
    return CustomElements(**{**dict(row), "omm": json.loads(row["omm"])})


def _state(row: sqlite3.Row) -> CustomState:
    return CustomState(**{**dict(row), "state": json.loads(row["state"])})


def _ephemeris(row: sqlite3.Row) -> CustomEphemeris:
    return CustomEphemeris(**{**dict(row), "meta": json.loads(row["meta"])})


class CustomSourcesMixin:
    """Repository methods for the tables of user-supplied orbit sources."""

    def _connect(self) -> AbstractContextManager[sqlite3.Connection]:
        raise NotImplementedError

    def _custom_rows(self, where: str, params: Sequence[Any]) -> Iterator[CustomElements]:
        with self._connect() as db:
            rows = db.execute(
                f"SELECT * FROM custom_elements {where} ORDER BY id", params
            ).fetchall()
        return (_custom(row) for row in rows)

    def custom_elements(self) -> list[CustomElements]:
        return list(self._custom_rows("", ()))

    def custom_element(self, custom_id: int) -> CustomElements | None:
        return next(self._custom_rows("WHERE id = ?", (custom_id,)), None)

    def add_custom_element(
        self, name: str, omm: dict[str, Any], input_format: str
    ) -> CustomElements:
        return self.add_custom_elements([(name, omm, input_format)])[0]

    def add_custom_elements(
        self, items: Sequence[tuple[str, dict[str, Any], str]]
    ) -> list[CustomElements]:
        ids: list[int] = []
        try:
            with self._connect() as db:
                for name, omm, input_format in items:
                    cursor = db.execute(
                        _INSERT_ELEMENTS, (name, json.dumps(omm), input_format, _now())
                    )
                    ids.append(int(cursor.lastrowid or 0))
        except sqlite3.IntegrityError as error:
            raise CustomElementNameTaken(str(error)) from error
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        return list(self._custom_rows(f"WHERE id IN ({marks})", ids))

    def delete_custom_element(self, custom_id: int) -> bool:
        with self._connect() as db:
            cursor = db.execute("DELETE FROM custom_elements WHERE id = ?", (custom_id,))
            return cursor.rowcount > 0

    # State vectors ------------------------------------------------------------------------

    def custom_states(self) -> list[CustomState]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM custom_states ORDER BY id").fetchall()
        return [_state(row) for row in rows]

    def custom_state(self, state_id: int) -> CustomState | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM custom_states WHERE id = ?", (state_id,)).fetchone()
        return _state(row) if row else None

    def add_custom_state(
        self, name: str, epoch: str, frame: str, state: dict[str, Any], input_format: str
    ) -> CustomState:
        try:
            with self._connect() as db:
                cursor = db.execute(
                    "INSERT INTO custom_states (name, epoch, frame, state, input_format, "
                    "created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, epoch, frame, json.dumps(state), input_format, _now()),
                )
                state_id = int(cursor.lastrowid or 0)
        except sqlite3.IntegrityError as error:
            raise CustomStateNameTaken(name) from error
        stored = self.custom_state(state_id)
        assert stored is not None
        return stored

    def delete_custom_state(self, state_id: int) -> bool:
        with self._connect() as db:
            cursor = db.execute("DELETE FROM custom_states WHERE id = ?", (state_id,))
            return cursor.rowcount > 0

    # Ephemerides --------------------------------------------------------------------------

    def custom_ephemerides(self) -> list[CustomEphemeris]:
        with self._connect() as db:
            rows = db.execute(
                f"SELECT {_EPHEMERIS_COLUMNS} FROM custom_ephemerides ORDER BY id"
            ).fetchall()
        return [_ephemeris(row) for row in rows]

    def custom_ephemeris(self, ephemeris_id: int) -> CustomEphemeris | None:
        with self._connect() as db:
            row = db.execute(
                f"SELECT {_EPHEMERIS_COLUMNS}, samples FROM custom_ephemerides WHERE id = ?",
                (ephemeris_id,),
            ).fetchone()
        return _ephemeris(row) if row else None

    def add_custom_ephemeris(
        self, name: str, meta: dict[str, Any], start: str, stop: str, samples: bytes, count: int
    ) -> CustomEphemeris:
        try:
            with self._connect() as db:
                cursor = db.execute(
                    "INSERT INTO custom_ephemerides (name, meta, start, stop, sample_count, "
                    "samples, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (name, json.dumps(meta), start, stop, count, samples, _now()),
                )
                ephemeris_id = int(cursor.lastrowid or 0)
        except sqlite3.IntegrityError as error:
            raise CustomEphemerisNameTaken(name) from error
        stored = self.custom_ephemeris(ephemeris_id)
        assert stored is not None
        return stored

    def delete_custom_ephemeris(self, ephemeris_id: int) -> bool:
        with self._connect() as db:
            cursor = db.execute("DELETE FROM custom_ephemerides WHERE id = ?", (ephemeris_id,))
            return cursor.rowcount > 0
