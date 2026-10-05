"""Saved sensor preset endpoints."""

import pytest

SENSOR_PRESET = {
    "name": "광학",
    "mode": "swath",
    "swath_km": 12.0,
    "fov_deg": 1.2,
    "max_off_nadir_deg": 30.0,
    "min_sun_elev_deg": 10.0,
}


def test_sensor_presets(bare_client):
    url = "/api/v1/sensor-presets"
    assert bare_client.get(url).json() == []

    created = bare_client.post(url, json=SENSOR_PRESET)
    assert created.status_code == 201
    preset = created.json()
    assert preset == {"id": preset["id"], **SENSOR_PRESET}
    assert bare_client.get(url).json() == [preset]

    edited = {**SENSOR_PRESET, "name": "광학 2", "mode": "fov", "fov_deg": 2.0}
    updated = bare_client.put(f"{url}/{preset['id']}", json=edited)
    assert updated.status_code == 200
    assert updated.json() == {"id": preset["id"], **edited}

    other = bare_client.post(url, json={**SENSOR_PRESET, "name": "SAR"}).json()
    clash = bare_client.post(url, json={**SENSOR_PRESET, "name": "SAR"})
    assert clash.status_code == 409
    assert clash.json()["detail"]["code"] == "sensorPresetNameTaken"
    clash = bare_client.put(f"{url}/{preset['id']}", json={**SENSOR_PRESET, "name": "SAR"})
    assert clash.status_code == 409
    assert clash.json()["detail"]["code"] == "sensorPresetNameTaken"

    missing = bare_client.put(f"{url}/9999", json=SENSOR_PRESET)
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "sensorPresetNotFound"

    assert bare_client.delete(f"{url}/{other['id']}").status_code == 204
    missing = bare_client.delete(f"{url}/{other['id']}")
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "sensorPresetNotFound"
    assert [p["id"] for p in bare_client.get(url).json()] == [preset["id"]]


@pytest.mark.parametrize(
    "change",
    [
        {"fov_deg": 200},
        {"fov_deg": 0},
        {"swath_km": 6000},
        {"max_off_nadir_deg": 89},
        {"min_sun_elev_deg": -30},
        {"mode": "both"},
        {"name": ""},
        {"name": "x" * 41},
    ],
)
def test_sensor_preset_validation(bare_client, change):
    response = bare_client.post("/api/v1/sensor-presets", json={**SENSOR_PRESET, **change})
    assert response.status_code == 422


def test_sensor_preset_requires_both_widths(bare_client):
    body = {k: v for k, v in SENSOR_PRESET.items() if k != "fov_deg"}
    assert bare_client.post("/api/v1/sensor-presets", json=body).status_code == 422
