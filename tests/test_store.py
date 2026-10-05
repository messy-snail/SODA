import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from soda.gp.models import normalize_omm
from soda.gp.sources import CustomEphemerisNameTaken, CustomStateNameTaken
from soda.gp.sqlite_store import SCHEMA, STATION_COLUMNS, SqliteStore
from soda.gp.store import (
    CustomElementNameTaken,
    SensorPresetNameTaken,
    StationNameTaken,
    open_store,
    probe_store,
)

NOW = datetime(2026, 9, 16, 12, tzinfo=UTC)


# Tests taking the ``store`` fixture are the ``Store`` contract. A new backend adds a param
# here; the SQLite-specific schema and migration tests further down do not apply to it.
@pytest.fixture(params=["sqlite"])
def store(request, tmp_path):
    if request.param == "sqlite":
        return SqliteStore(tmp_path / "soda.db")
    raise NotImplementedError(request.param)


def test_keeps_newest_epoch(store, iss_record):
    element = normalize_omm(iss_record, "celestrak")
    older = replace(element, epoch=element.epoch - timedelta(days=1), source="old")
    store.upsert_latest([element], NOW)
    store.upsert_latest([older], NOW)
    assert store.latest(25544).source == "celestrak"
    newer = replace(element, epoch=element.epoch + timedelta(microseconds=1), source="new")
    store.upsert_latest([newer], NOW)
    assert store.latest(25544).source == "new"


def test_search_by_name_id_and_group(store, iss_record):
    iss = normalize_omm(iss_record, "celestrak")
    other = normalize_omm(
        dict(iss_record, NORAD_CAT_ID=43013, OBJECT_NAME="NOAA 20 (JPSS-1)"), "celestrak"
    )
    store.upsert_latest([iss, other], NOW)
    store.replace_group("stations", [25544])
    assert [e.norad_id for e in store.search("zarya", None, 10)] == [25544]
    assert [e.norad_id for e in store.search("4301", None, 10)] == [43013]
    assert [e.norad_id for e in store.search("", "stations", 10)] == [25544]
    assert store.groups_of(25544) == ["stations"]
    assert [e.norad_id for e in store.group_elements("stations")] == [25544]


def test_fetch_log_counts_consecutive_errors(store):
    store.record_fetch("celestrak", "group:active", at=NOW, status="error", ok=False)
    store.record_fetch("celestrak", "group:active", at=NOW, status="error", ok=False)
    record = store.fetch_record("celestrak", "group:active")
    assert record.consecutive_errors == 2
    assert record.last_ok_at is None
    later = NOW + timedelta(minutes=5)
    store.record_fetch("celestrak", "group:active", at=later, status="ok", ok=True, object_count=9)
    record = store.fetch_record("celestrak", "group:active")
    assert record.consecutive_errors == 0
    assert record.last_ok_at == later
    assert record.object_count == 9


def test_default_station_and_crud(store):
    stations = store.stations()
    # Asserted by preset, not by name: the wording is the frontend's to choose.
    assert [s.preset_id for s in stations] == ["kari-naro"]
    added = store.add_station("서울", 37.57, 126.98, 40, 5)
    assert store.station(added.id).min_elev_deg == 5
    assert store.delete_station(added.id)
    assert not store.delete_station(added.id)


def test_duplicate_station_name_is_a_domain_error(store):
    first = store.add_station("서울", 37.57, 126.98, 40, 5)
    second = store.add_station("부산", 35.18, 129.08, 10, 5)
    with pytest.raises(StationNameTaken):
        store.add_station("서울", 0, 0, 0, 5)
    with pytest.raises(StationNameTaken):
        store.update_station(second.id, "서울", 35.18, 129.08, 10, 5)
    assert store.station(first.id).lat_deg == 37.57


OLD_STATIONS_SCHEMA = """
CREATE TABLE stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    lat_deg REAL NOT NULL,
    lon_deg REAL NOT NULL,
    alt_m REAL NOT NULL DEFAULT 0,
    min_elev_deg REAL NOT NULL DEFAULT 10
);
"""


def test_station_mask_and_preset_round_trip(store):
    mask = [(0.0, 5.0), (120.0, 30.0), (240.0, 12.0)]
    added = store.add_station("제주", 33.5, 126.5, 20, 5, preset_id="kari-jeju", az_mask=mask)
    assert added.preset_id == "kari-jeju"
    assert added.az_mask == tuple(mask)
    assert store.station(added.id).az_mask == tuple(mask)

    edited = store.update_station(added.id, "제주 2", 33.6, 126.6, 25, 7)
    assert edited.id == added.id
    assert (edited.name, edited.min_elev_deg, edited.az_mask, edited.preset_id) == (
        "제주 2",
        7,
        (),
        None,
    )
    assert store.update_station(9999, "없음", 0, 0, 0, 5) is None


def test_migration_adds_columns_to_an_existing_database(tmp_path):
    """An installed data/soda.db must survive the upgrade, never be re-created."""
    path = tmp_path / "soda.db"
    with sqlite3.connect(path) as db:
        db.executescript(OLD_STATIONS_SCHEMA)
        db.execute("INSERT INTO stations (name, lat_deg, lon_deg) VALUES ('대전', 36.35, 127.38)")

    store = SqliteStore(path)
    stations = store.stations()
    assert [s.name for s in stations] == ["대전"]
    assert stations[0].az_mask == ()
    assert stations[0].preset_id is None
    assert stations[0].min_elev_deg == 10


def test_sensor_preset_crud(store):
    assert store.sensor_presets() == []
    first = store.add_sensor_preset("광학", "swath", 12.0, 1.2, 30.0, 10.0)
    second = store.add_sensor_preset("SAR", "fov", 40.0, 5.0, 45.0, -18.0)
    assert [p.id for p in store.sensor_presets()] == [first.id, second.id]
    assert store.sensor_preset(first.id) == first
    assert (first.name, first.mode, first.swath_km, first.fov_deg) == ("광학", "swath", 12.0, 1.2)
    assert (first.max_off_nadir_deg, first.min_sun_elev_deg) == (30.0, 10.0)

    edited = store.update_sensor_preset(first.id, "광학 2", "fov", 15.0, 1.5, 20.0, 5.0)
    assert edited.id == first.id
    assert store.sensor_preset(first.id) == edited
    assert (edited.name, edited.mode, edited.swath_km) == ("광학 2", "fov", 15.0)
    assert store.update_sensor_preset(9999, "없음", "swath", 1, 1, 0, 0) is None

    assert store.delete_sensor_preset(second.id)
    assert not store.delete_sensor_preset(second.id)
    assert store.sensor_preset(second.id) is None
    assert store.stats()["sensor_presets"] == 1


def test_duplicate_sensor_preset_name_is_a_domain_error(store):
    first = store.add_sensor_preset("광학", "swath", 12.0, 1.2, 0.0, 10.0)
    second = store.add_sensor_preset("SAR", "fov", 40.0, 5.0, 0.0, -18.0)
    with pytest.raises(SensorPresetNameTaken):
        store.add_sensor_preset("광학", "fov", 1.0, 1.0, 0.0, 0.0)
    with pytest.raises(SensorPresetNameTaken):
        store.update_sensor_preset(second.id, "광학", "fov", 40.0, 5.0, 0.0, -18.0)
    assert store.sensor_preset(first.id) == first
    assert store.sensor_preset(second.id).name == "SAR"


def test_migration_adds_sensor_presets_to_an_existing_database(tmp_path):
    """A database from before sensor presets gains the table on open, keeping its rows."""
    path = tmp_path / "soda.db"
    with sqlite3.connect(path) as db:
        db.executescript(OLD_STATIONS_SCHEMA)
        db.execute("INSERT INTO stations (name, lat_deg, lon_deg) VALUES ('대전', 36.35, 127.38)")

    store = SqliteStore(path)
    assert [s.name for s in store.stations()] == ["대전"]
    assert store.sensor_presets() == []
    added = store.add_sensor_preset("광학", "swath", 12.0, 1.2, 0.0, 10.0)
    assert store.sensor_presets() == [added]
    assert store.custom_elements() == []


def test_custom_element_crud(store, iss_record):
    omm = normalize_omm(iss_record, "user").omm
    assert store.custom_elements() == []
    first = store.add_custom_element("내 ISS", omm, "tle")
    second = store.add_custom_element("OMM 사본", omm, "omm")
    assert [c.id for c in store.custom_elements()] == [first.id, second.id]
    assert store.custom_element(first.id) == first
    assert (first.name, first.omm, first.input_format) == ("내 ISS", omm, "tle")
    assert first.created_at.endswith("Z")
    assert datetime.fromisoformat(first.created_at).tzinfo is not None
    element = first.element_set()
    assert (element.name, element.source, element.norad_id) == ("내 ISS", "user", 25544)

    with pytest.raises(CustomElementNameTaken):
        store.add_custom_element("내 ISS", omm, "omm")
    assert store.stats()["custom_elements"] == 2

    assert store.delete_custom_element(second.id)
    assert not store.delete_custom_element(second.id)
    assert store.custom_element(second.id) is None
    assert store.stats()["custom_elements"] == 1


def test_group_counts(store, iss_record):
    assert store.group_counts() == {}
    store.replace_group("stations", [25544, 43013])
    store.replace_group("visual", [25544])
    assert store.group_counts() == {"stations": 2, "visual": 1}


def test_schema_declares_every_migrated_column():
    """A fresh database and a migrated one must end up with the same columns."""
    for name, _ddl in STATION_COLUMNS:
        assert name in SCHEMA


def test_open_store_reads_sqlite_urls(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    relative = open_store("sqlite:///data/soda.db")
    assert isinstance(relative, SqliteStore)
    assert relative.path == Path("data/soda.db")
    absolute = open_store(f"sqlite:///{(tmp_path / 'x.db').as_posix()}")
    assert absolute.path == tmp_path / "x.db"


def test_probe_store_never_creates_a_database(tmp_path):
    target = tmp_path / "new" / "soda.db"
    result = probe_store(f"sqlite:///{target.as_posix()}")
    assert (result.ok, result.exists, result.initialized) == (True, False, False)
    assert not target.exists() and not target.parent.exists()


def test_probe_store_reads_an_existing_database(tmp_path):
    target = tmp_path / "soda.db"
    store = open_store(f"sqlite:///{target.as_posix()}")
    assert store.stats() == {
        "objects": 0,
        "history": 0,
        "stations": 1,
        "sensor_presets": 0,
        "custom_elements": 0,
        "fetches": 0,
    }
    before = target.read_bytes()
    result = probe_store(f"sqlite:///{target.as_posix()}")
    assert (result.ok, result.exists, result.initialized) == (True, True, True)
    assert target.read_bytes() == before


def test_probe_store_refuses_files_it_cannot_use(tmp_path):
    junk = tmp_path / "notes.db"
    junk.write_text("not a database")
    assert not probe_store(f"sqlite:///{junk.as_posix()}").ok
    other = tmp_path / "other.db"
    with sqlite3.connect(other) as db:
        db.execute("CREATE TABLE invoices (id INTEGER)")
    assert not probe_store(f"sqlite:///{other.as_posix()}").ok
    assert not probe_store(f"sqlite:///{tmp_path.as_posix()}").ok


@pytest.mark.parametrize("url", ["postgresql://localhost/soda", "sqlite://", "soda.db", ""])
def test_probe_store_rejects_unknown_urls(url):
    with pytest.raises(ValueError, match="sqlite:///"):
        probe_store(url)


@pytest.mark.parametrize("url", ["postgresql://localhost/soda", "sqlite://", "soda.db", ""])
def test_open_store_rejects_unknown_urls(url):
    with pytest.raises(ValueError, match="sqlite:///"):
        open_store(url)


def test_browse_pages_and_filters(store, iss_record):
    store.upsert_latest([normalize_omm(iss_record, "celestrak")], NOW)
    tables = {info.name: info for info in store.tables()}
    assert tables["gp_latest"].count == 1
    page = store.browse("gp_latest", 0, 10, "iss")
    assert page.total == 1
    assert page.rows[0]["omm"]["NORAD_CAT_ID"] == 25544
    assert store.browse("gp_latest", 0, 10, "25544").total == 1
    assert store.browse("gp_latest", 1, 10, "").rows == []
    with pytest.raises(KeyError):
        store.browse("sqlite_master", 0, 10, "")


def test_backup_to_writes_a_readable_copy(store, tmp_path):
    target = tmp_path / "backup.db"
    store.backup_to(target)
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT COUNT(*) FROM stations").fetchone()[0] == 1


def test_custom_elements_bulk_add_is_all_or_nothing(store, iss_record):
    omm = normalize_omm(iss_record, "user").omm
    added = store.add_custom_elements([("a", omm, "tle"), ("b", omm, "omm")])
    assert [(c.name, c.input_format) for c in added] == [("a", "tle"), ("b", "omm")]
    assert store.add_custom_elements([]) == []
    with pytest.raises(CustomElementNameTaken):
        store.add_custom_elements([("c", omm, "omm"), ("a", omm, "omm")])
    assert [c.name for c in store.custom_elements()] == ["a", "b"]


def test_custom_state_crud(store):
    state = {"x_m": 7.0e6, "y_m": 0.0, "z_m": 0.0, "vx_m_s": 0.0, "vy_m_s": 7546.0, "vz_m_s": 0.0}
    assert store.custom_states() == []
    first = store.add_custom_state("내 상태", "2026-09-16T00:00:00.000000Z", "GCRF", state, "form")
    second = store.add_custom_state(
        "OPM", "2026-09-16T00:00:00.000000Z", "ITRF", {**state, "mass_kg": 100.0}, "opm"
    )
    assert [c.id for c in store.custom_states()] == [first.id, second.id]
    assert store.custom_state(first.id) == first
    assert (first.name, first.frame, first.state, first.input_format) == (
        "내 상태",
        "GCRF",
        state,
        "form",
    )
    assert second.state["mass_kg"] == 100.0 and first.created_at.endswith("Z")
    with pytest.raises(CustomStateNameTaken):
        store.add_custom_state("OPM", "2026-09-16T00:00:00.000000Z", "GCRF", state, "form")
    assert store.delete_custom_state(second.id)
    assert not store.delete_custom_state(second.id)
    assert store.custom_state(second.id) is None


def test_custom_ephemeris_crud(store):
    samples = bytes(range(56)) * 3
    meta = {"object_id": "X", "frame": "GCRF", "degree": 2, "segments": [[0, 3]]}
    start, stop = "2026-09-16T00:00:00.000000Z", "2026-09-16T00:02:00.000000Z"
    assert store.custom_ephemerides() == []
    first = store.add_custom_ephemeris("표", meta, start, stop, samples, 3)
    assert (first.name, first.meta, first.start, first.stop) == ("표", meta, start, stop)
    assert (first.sample_count, first.samples) == (3, samples)
    assert store.custom_ephemeris(first.id) == first
    # A listing leaves the samples in the database.
    assert [(c.id, c.samples) for c in store.custom_ephemerides()] == [(first.id, None)]
    with pytest.raises(CustomEphemerisNameTaken):
        store.add_custom_ephemeris("표", meta, start, stop, samples, 3)
    assert store.delete_custom_ephemeris(first.id)
    assert not store.delete_custom_ephemeris(first.id)
    assert store.custom_ephemeris(first.id) is None
