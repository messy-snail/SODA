"""Database browsing, export/import, and download endpoints."""

import json
import sqlite3


def test_tables_list_counts_and_columns(bare_client):
    tables = {t["name"]: t for t in bare_client.get("/api/v1/database/tables").json()}
    assert set(tables) >= {"gp_latest", "fetch_log", "stations", "custom_elements"}
    assert tables["stations"]["count"] == 1
    assert "az_mask" in tables["stations"]["columns"]


def test_browse_parses_json_columns_and_searches(bare_client):
    page = bare_client.get("/api/v1/database/tables/stations").json()
    assert page["total"] == 1
    assert page["rows"][0]["az_mask"] == []
    assert page["columns"][0] == "id"
    empty = bare_client.get("/api/v1/database/tables/stations", params={"q": "nowhere"}).json()
    assert (empty["total"], empty["rows"]) == (0, [])


def test_browse_rejects_unknown_tables(bare_client):
    response = bare_client.get("/api/v1/database/tables/sqlite_master")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "databaseTableUnknown"


def test_export_then_import_round_trip(bare_client, iss_record):
    bare_client.post(
        "/api/v1/sensor-presets",
        json={
            "name": "cam",
            "mode": "fov",
            "swath_km": 100,
            "fov_deg": 10,
            "max_off_nadir_deg": 30,
            "min_sun_elev_deg": 10,
        },
    )
    text = json.dumps(iss_record)
    assert bare_client.post(
        "/api/v1/custom-elements", json={"name": "mine", "text": text}
    ).is_success
    state = {
        "name": "sv",
        "epoch": "2026-09-16T00:00:00Z",
        "frame": "GCRF",
        "x_m": 7.0e6,
        "y_m": 0.0,
        "z_m": 0.0,
        "vx_m_s": 0.0,
        "vy_m_s": 7546.0,
        "vz_m_s": 0.0,
        "mass_kg": 120.0,
    }
    assert bare_client.post("/api/v1/custom-states", json=state).is_success

    exported = bare_client.get("/api/v1/database/export")
    assert "attachment" in exported.headers["content-disposition"]
    data = exported.json()
    assert data["format"] == "soda-userdata"
    assert [s["name"] for s in data["sensor_presets"]] == ["cam"]
    assert [c["name"] for c in data["custom_elements"]] == ["mine"]
    assert [c["name"] for c in data["custom_states"]] == ["sv"]
    assert data["custom_states"][0]["state"]["mass_kg"] == 120.0

    # Everything is already there: all names clash.
    again = bare_client.post("/api/v1/database/import", json=data).json()
    assert again["added"] == {
        "stations": 0,
        "sensor_presets": 0,
        "custom_elements": 0,
        "custom_states": 0,
    }
    assert {item["reason"] for item in again["skipped"]} == {"nameTaken"}

    for kind in ("stations", "sensor_presets", "custom_elements", "custom_states"):
        for entry in data[kind]:
            entry["name"] += " (copy)"
    data["custom_elements"].append({"name": "broken", "omm": {"NORAD_CAT_ID": 1}})
    data["custom_states"].append(
        {"name": "underground", "epoch": "2026-09-16T00:00:00Z", "state": {"x_m": 1.0}}
    )
    result = bare_client.post("/api/v1/database/import", json=data).json()
    assert result["added"] == {
        "stations": 1,
        "sensor_presets": 1,
        "custom_elements": 1,
        "custom_states": 1,
    }
    assert result["skipped"] == [
        {"kind": "custom_elements", "name": "broken", "reason": "invalid"},
        {"kind": "custom_states", "name": "underground", "reason": "invalid"},
    ]
    states = bare_client.get("/api/v1/custom-states").json()
    assert [item["name"] for item in states] == ["sv", "sv (copy)"]
    assert len(bare_client.get("/api/v1/stations").json()) == 2


def test_import_rejects_other_files(bare_client):
    response = bare_client.post("/api/v1/database/import", json={"format": "other"})
    assert response.status_code == 422


def test_download_is_a_sqlite_snapshot(bare_client, tmp_path):
    response = bare_client.get("/api/v1/database/download")
    assert response.status_code == 200
    assert response.content.startswith(b"SQLite format 3\x00")
    copy = tmp_path / "copy.db"
    copy.write_bytes(response.content)
    with sqlite3.connect(copy) as db:
        assert db.execute("SELECT COUNT(*) FROM stations").fetchone()[0] == 1
