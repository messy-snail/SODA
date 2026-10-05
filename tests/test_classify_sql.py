"""``CATEGORY_SQL`` must agree with ``classify`` and drive the store's category filter."""

import json
import sqlite3
from datetime import UTC, datetime
from itertools import pairwise

import pytest

from soda.gp.classify import CATEGORIES, CATEGORY_SQL, DEBRIS_MARKERS, classify
from soda.gp.models import normalize_omm
from soda.gp.sqlite_store import SqliteStore

NOW = datetime(2026, 9, 16, 12, tzinfo=UTC)
EPS = 1e-9

# (name, mean motion rev/day, eccentricity) covering every branch and each threshold edge.
CASES = [
    ("ISS (ZARYA)", 15.5, 0.0004),
    ("LEO EDGE", 11.25, 0.0),
    ("LEO JUST ABOVE", 11.25 + EPS, 0.0),
    ("MEO NAV", 2.0, 0.01),
    ("GEO SAT", 1.0027, 0.0002),
    ("GEO LOW EDGE", 0.9, 0.0),
    ("GEO LOW INSIDE", 0.9 + EPS, 0.0),
    ("GEO HIGH EDGE", 1.1, 0.0),
    ("GEO HIGH INSIDE", 1.1 - EPS, 0.0),
    ("GEO ECC EDGE", 1.0, 0.1),
    ("GEO ECC INSIDE", 1.0, 0.1 - EPS),
    ("MOLNIYA 1-93", 2.006, 0.72),
    ("HEO EDGE", 2.0, 0.25),
    ("HEO JUST ABOVE", 2.0, 0.25 + EPS),
    ("FENGYUN 1C DEB", 14.2, 0.005),
    ("DEBRIS CLOUD", 1.0, 0.0),
    ("CZ-3B ROCKET BODY", 2.2, 0.7),
    ("SL-12 R/B(2)", 1.0, 0.001),
    ("OBJECT A", 14.9, 0.001),
    ("OBJECTA", 14.9, 0.001),  # no trailing space: not the "OBJECT " marker
    ("DEB", 14.9, 0.001),  # no leading space: not the " DEB" marker
    ("cosmos 2251 deb", 14.3, 0.002),  # lower case still matches after upper()
    ("50% ODD_NAME's", 15.0, 0.0),  # LIKE wildcards and quotes stay literal
    ("R_B LOOKALIKE", 15.0, 0.0),
]


def _record(iss_record: dict, norad_id: int, name: str, mean_motion, eccentricity) -> dict:
    return dict(
        iss_record,
        NORAD_CAT_ID=norad_id,
        OBJECT_NAME=name,
        MEAN_MOTION=mean_motion,
        ECCENTRICITY=eccentricity,
    )


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "soda.db"


@pytest.fixture
def store(db_path):
    return SqliteStore(db_path)


def test_cases_cover_every_marker():
    names = " | ".join(name.upper() for name, _, _ in CASES)
    assert all(marker in names for marker in DEBRIS_MARKERS)


def test_sql_matches_python_for_every_row(store, db_path, iss_record):
    records = [
        _record(iss_record, 10000 + i, name, mm, ecc) for i, (name, mm, ecc) in enumerate(CASES)
    ]
    store.upsert_latest([normalize_omm(r, "celestrak") for r in records], NOW)
    # A row whose JSON holds strings, as a raw Space-Track record would, casts the same way.
    raw = _record(iss_record, 99001, "STRING FIELDS", "1.0003", "0.0005")
    records.append(raw)
    with sqlite3.connect(db_path) as db:
        db.execute(
            "INSERT INTO gp_latest (norad_id, epoch, source, name, object_id, omm, updated_at) "
            "VALUES (?, '2026-09-16T00:00:00', 'test', ?, '', ?, '2026-09-16T00:00:00')",
            (99001, raw["OBJECT_NAME"], json.dumps(raw)),
        )
        rows = db.execute(f"SELECT norad_id, {CATEGORY_SQL} FROM gp_latest").fetchall()
    expected = {int(r["NORAD_CAT_ID"]): classify(r) for r in records}
    assert dict(rows) == expected
    assert set(expected.values()) == set(CATEGORIES)


def test_search_filters_category_before_limit(store, iss_record):
    geo = [_record(iss_record, 20000 + i, f"GEO {i:02d}", 1.0027, 0.0002) for i in range(5)]
    leo = [_record(iss_record, 30000 + i, f"LEO {i:02d}", 15.5, 0.0) for i in range(30)]
    store.upsert_latest([normalize_omm(r, "celestrak") for r in geo + leo], NOW)

    found = store.search("", None, 3, category="GEO")
    assert [e.name for e in found] == ["GEO 00", "GEO 01", "GEO 02"]
    assert len(store.search("", None, 50, category="GEO")) == 5
    leo_page = store.search("", None, 10, category="LEO")
    assert len(leo_page) == 10 and all(classify(e.omm) == "LEO" for e in leo_page)
    names = [e.name for e in store.search("", None, 100, category="LEO")]
    assert len(names) == 30 and all(a <= b for a, b in pairwise(names))
    assert [e.name for e in store.search("o 1", None, 20, category="LEO")] == [
        f"LEO 1{i}" for i in range(10)
    ]
    assert store.search("leo", None, 10, category="GEO") == []
    assert store.search("", None, 10, category="HEO") == []
    store.replace_group("geo", [20001, 30001])
    assert [e.norad_id for e in store.search("", "geo", 10, category="GEO")] == [20001]
    # Without a category an empty query still lists everything, as before.
    assert len(store.search("", None, 100)) == 35
