"""Imaging opportunity endpoint."""

import pytest

START = "2026-09-16T00:00:00Z"
END = "2026-09-18T00:00:00Z"
TARGETS = [
    {"id": "daejeon", "lat_deg": 36.35, "lon_deg": 127.38},
    {"id": "korea", "west_deg": 125, "south_deg": 33, "east_deg": 130, "north_deg": 38.5},
]


def search(client, **pointing):
    body = {"norad_id": 25544, "targets": TARGETS, "start": START, "end": END, **pointing}
    return client.post("/api/v1/access", json=body)


def test_roll_only_is_the_default_and_gives_instants(client):
    data = search(client, max_roll_deg=30).json()
    assert [r["target_id"] for r in data["results"]] == ["daejeon", "korea"]
    assert data["element_set"]["norad_id"] == 25544
    point, box = data["results"]
    assert len(box["windows"]) >= len(point["windows"]) >= 1
    window = point["windows"][0]
    assert window["start"] == window["best_time"] == window["end"]
    assert window["start"].endswith("Z")
    assert window["duration_s"] == 0 and abs(window["pitch_deg"]) < 0.05
    assert abs(window["roll_deg"]) <= 30
    assert window["target_sun_elev_deg"] >= 10
    assert set(window) >= {"coverage", "ascending", "clipped_start", "clipped_end", "aim_lat_deg"}
    assert box["windows"][0]["duration_s"] > 0
    strip = window["strip"]
    assert len(strip["left"]) == len(strip["right"]) >= 4 and len(strip["left"]) % 2 == 0
    assert len(window["track_fixed_m"]) == len(strip["left"]) // 2 * 3
    assert window["shot_start"] < window["best_time"] < window["shot_end"]
    diagnosis = point["diagnosis"]
    assert set(diagnosis) == {"passes", "dark", "best_sun_elev_deg", "nearest_roll_deg"}
    # Every window is a pass in reach; the rest of them were too dark.
    assert diagnosis["passes"] - diagnosis["dark"] == len(point["windows"])
    assert diagnosis["nearest_roll_deg"] <= 30


def test_roll_pitch_gives_windows_and_fov_widens_reach(client):
    agile = search(client, mode="roll_pitch", max_roll_deg=30, max_pitch_deg=20).json()
    window = agile["results"][0]["windows"][0]
    assert window["start"] < window["best_time"] < window["end"]
    assert abs(window["pitch_deg"]) <= 20 and abs(window["roll_deg"]) <= 30

    def count(**pointing):
        return sum(len(r["windows"]) for r in search(client, **pointing).json()["results"])

    assert count(max_roll_deg=10, fov_deg=40) >= count(max_roll_deg=10)


def test_access_validation(client):
    base = {"norad_id": 25544, "start": START, "end": END, "max_roll_deg": 30}
    one = [{"id": "a", "lat_deg": 0, "lon_deg": 0}]
    too_long = {**base, "end": "2026-10-17T00:00:00Z", "targets": one}
    response = client.post("/api/v1/access", json=too_long)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "accessWindowTooLong"

    many = {**base, "targets": [{"id": str(i), "lat_deg": 0, "lon_deg": i} for i in range(21)]}
    assert client.post("/api/v1/access", json=many).json()["detail"]["code"] == "tooManyTargets"

    mixed = {**base, "targets": [{"id": "x", "lat_deg": 0, "lon_deg": 0, "west_deg": 1}]}
    assert client.post("/api/v1/access", json=mixed).json()["detail"]["code"] == "invalidRequest"


@pytest.mark.parametrize(
    "bad", [{"max_roll_deg": 0}, {"mode": "yaw"}, {"fov_deg": -1}, {"max_pitch_deg": 90}]
)
def test_pointing_validation(client, bad):
    body = {
        "norad_id": 25544,
        "targets": TARGETS[:1],
        "start": START,
        "end": END,
        "max_roll_deg": 30,
        **bad,
    }
    assert client.post("/api/v1/access", json=body).status_code == 422


def test_access_far_from_epoch_warns(client):
    near = search(client, max_roll_deg=30).json()
    assert not [w for w in near["warnings"] if w["code"] == "elementsFarFromEpoch"]
    body = {
        "norad_id": 25544,
        "targets": TARGETS[:1],
        "start": "2026-09-25T00:00:00Z",
        "end": "2026-09-26T00:00:00Z",
        "max_roll_deg": 30,
    }
    data = client.post("/api/v1/access", json=body).json()
    assert [w["params"]["days"] for w in data["warnings"]] == [10]
