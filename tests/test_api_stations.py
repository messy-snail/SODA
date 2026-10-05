"""Ground station and pass prediction endpoints."""

import pytest
from conftest import one_satellite

from soda.orbit.passes import MAX_STATIONS

START = "2026-09-16T00:00:00Z"


def test_stations_and_passes(client):
    stations = client.get("/api/v1/stations").json()
    assert stations[0]["preset_id"] == "kari-naro"
    created = client.post(
        "/api/v1/stations", json={"name": "서울", "lat_deg": 37.57, "lon_deg": 126.98}
    )
    assert created.status_code == 201
    duplicate = client.post(
        "/api/v1/stations", json={"name": "서울", "lat_deg": 37.57, "lon_deg": 126.98}
    )
    assert duplicate.status_code == 409
    assert client.delete(f"/api/v1/stations/{created.json()['id']}").status_code == 204

    body = {
        "norad_id": 25544,
        "station_ids": [stations[0]["id"]],
        "start": START,
        "end": "2026-09-17T00:00:00Z",
    }
    data = client.post("/api/v1/passes", json=one_satellite(body)).json()
    result = data["satellites"][0]["results"][0]
    assert result["min_elev_deg"] == stations[0]["min_elev_deg"]
    assert len(result["passes"]) >= 3
    assert result["passes"][0]["aos"].endswith("Z")
    assert result["passes"][0]["station_id"] == stations[0]["id"]
    assert len(result["passes"][0]["track_fixed_m"]) % 3 == 0
    assert len(result["passes"][0]["track_fixed_m"]) >= 6
    assert result["passes"][0]["clipped_start"] is False
    assert result["passes"][0]["clipped_end"] is False
    # The seeded station accepts 5 deg, which reaches further than the old 10 deg default.
    assert result["visibility"]["radius_km"] == pytest.approx(1760, abs=40)
    assert len(result["visibility"]["ring"]) == 129


def test_station_mask_and_update(client):
    mask = [{"az_deg": 0, "min_elev_deg": 5}, {"az_deg": 180, "min_elev_deg": 35}]
    created = client.post(
        "/api/v1/stations",
        json={
            "name": "능선 지상국",
            "lat_deg": 37.57,
            "lon_deg": 126.98,
            "preset_id": "ksat-svalbard",
            "az_mask": mask,
        },
    )
    assert created.status_code == 201
    station = created.json()
    assert station["az_mask"] == mask
    assert station["preset_id"] == "ksat-svalbard"

    edited = client.put(
        f"/api/v1/stations/{station['id']}",
        json={"name": "능선 지상국", "lat_deg": 37.57, "lon_deg": 126.98, "min_elev_deg": 20},
    )
    assert edited.status_code == 200
    assert edited.json()["az_mask"] == []
    assert edited.json()["min_elev_deg"] == 20
    assert edited.json()["id"] == station["id"]

    missing = client.put(
        "/api/v1/stations/99999", json={"name": "없음", "lat_deg": 0, "lon_deg": 0}
    )
    assert missing.status_code == 404
    assert client.delete(f"/api/v1/stations/{station['id']}").status_code == 204


@pytest.mark.parametrize(
    ("az_mask", "code"),
    [
        ([{"az_deg": 10, "min_elev_deg": 5}], "maskTooFewPoints"),
        (
            [{"az_deg": 10, "min_elev_deg": 5}, {"az_deg": 10, "min_elev_deg": 20}],
            "maskDuplicateAzimuth",
        ),
        # Out-of-range angles are caught by the field constraints, before the mask rules.
        (
            [{"az_deg": 360, "min_elev_deg": 5}, {"az_deg": 10, "min_elev_deg": 20}],
            "invalidRequest",
        ),
        (
            [{"az_deg": 10, "min_elev_deg": 90}, {"az_deg": 20, "min_elev_deg": 20}],
            "invalidRequest",
        ),
    ],
)
def test_station_rejects_unusable_mask(client, az_mask, code):
    """A validator that raised a coded error keeps its code through the 422 handler."""
    response = client.post(
        "/api/v1/stations",
        json={"name": "잘못된 마스크", "lat_deg": 0, "lon_deg": 0, "az_mask": az_mask},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


def test_passes_over_several_stations(client):
    """Results follow the requested order and share one element set."""
    first = client.get("/api/v1/stations").json()[0]["id"]
    second = client.post(
        "/api/v1/stations",
        json={"name": "제주", "lat_deg": 33.5, "lon_deg": 126.5, "min_elev_deg": 20},
    ).json()["id"]
    window = {"start": START, "end": "2026-09-17T00:00:00Z"}

    body = {"norad_id": 25544, "station_ids": [second, first], **window}
    results = client.post("/api/v1/passes", json=one_satellite(body)).json()["satellites"][0][
        "results"
    ]
    assert [item["station"]["id"] for item in results] == [second, first]
    assert [item["min_elev_deg"] for item in results] == [20, 5]
    assert all(
        entry["station_id"] == item["station"]["id"] for item in results for entry in item["passes"]
    )
    # A lower minimum sees the satellite for longer, so it reaches further.
    reach = [item["visibility"]["radius_km"] for item in results]
    assert reach[0] < reach[1]

    body = {"norad_id": 25544, "station_ids": [first, first], **window}
    repeated = client.post("/api/v1/passes", json=one_satellite(body)).json()
    assert len(repeated["satellites"][0]["results"]) == 1


def test_passes_rejects_unknown_and_oversized_station_lists(client):
    known = client.get("/api/v1/stations").json()[0]["id"]
    window = {"start": START, "end": "2026-09-17T00:00:00Z"}

    missing = client.post(
        "/api/v1/passes",
        json=one_satellite({"norad_id": 25544, "station_ids": [known, 99999], **window}),
    )
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "stationNotFound"
    assert missing.json()["detail"]["params"]["ids"] == [99999]

    too_many = client.post(
        "/api/v1/passes",
        json=one_satellite(
            {"norad_id": 25544, "station_ids": list(range(1, MAX_STATIONS + 2)), **window}
        ),
    )
    assert too_many.status_code == 422
    assert (
        client.post(
            "/api/v1/passes",
            json=one_satellite({"norad_id": 25544, "station_ids": [], **window}),
        ).status_code
        == 422
    )


def test_passes_with_a_mask_reach_unevenly(client):
    """A mask makes the visibility outline lobed instead of circular."""
    plain = client.post(
        "/api/v1/stations", json={"name": "평지", "lat_deg": 37.5, "lon_deg": 127.0}
    ).json()["id"]
    ridged = client.post(
        "/api/v1/stations",
        json={
            "name": "산지",
            "lat_deg": 37.5,
            "lon_deg": 127.0,
            "az_mask": [{"az_deg": 0, "min_elev_deg": 10}, {"az_deg": 180, "min_elev_deg": 45}],
        },
    ).json()["id"]
    body = {
        "norad_id": 25544,
        "station_ids": [plain, ridged],
        "start": START,
        "end": "2026-09-18T00:00:00Z",
    }
    data = client.post("/api/v1/passes", json=one_satellite(body)).json()
    flat_result, masked_result = data["satellites"][0]["results"]
    assert len(masked_result["passes"]) <= len(flat_result["passes"])
    assert any(item["mask_limited"] for item in masked_result["passes"])

    def spread(ring):
        lats = [lat for _lon, lat in ring]
        return max(lats) - min(lats)

    assert spread(masked_result["visibility"]["ring"]) < spread(flat_result["visibility"]["ring"])


def test_two_satellites_share_stations_by_priority(client):
    """Two copies of one orbit collide on every pass; priority gives them all to the first."""
    station = client.get("/api/v1/stations").json()[0]["id"]
    iss = {"norad_id": 25544, "start": START, "end": "2026-09-18T00:00:00Z"}
    body = {"satellites": [iss, iss], "station_ids": [station], "turnaround_s": 60}
    data = client.post("/api/v1/passes", json=body).json()
    assert [s["index"] for s in data["satellites"]] == [0, 1]
    first, second = (s["results"][0]["passes"] for s in data["satellites"])
    assert len(first) == len(second) >= 3
    assert all(p["status"] == "assigned" and p["satellite_index"] == 0 for p in first)
    assert all(p["status"] == "rejected" and p["satellite_index"] == 1 for p in second)
    assert data["assigned"] == len(first) and data["rejected"] == len(second)
    assert any(p["id"] in second[0]["conflict_with"] for p in first)
    assert first[0]["id"].startswith(f"0:{station}:")
    assert 300 < first[0]["tca_range_km"] < 3000


def test_pass_limits(client):
    station = client.get("/api/v1/stations").json()[0]["id"]

    def code(satellites):
        body = {"satellites": satellites, "station_ids": [station]}
        response = client.post("/api/v1/passes", json=body)
        assert response.status_code == 422
        return response.json()["detail"]["code"]

    day = {"norad_id": 25544, "start": START, "end": "2026-09-17T00:00:00Z"}
    month = {**day, "end": "2026-10-16T00:00:00Z"}
    assert code([]) == "noSatelliteSelected"
    assert code([day] * 9) == "tooManySatellites"
    assert code([{**day, "end": "2026-10-17T00:00:00Z"}]) == "passWindowTooLong"
    assert code([month, month, month]) == "passBudgetExceeded"


def test_passes_far_from_epoch_warn_per_satellite(client):
    station = client.get("/api/v1/stations").json()[0]["id"]
    near = {"norad_id": 25544, "start": START, "end": "2026-09-17T00:00:00Z"}
    far = {"norad_id": 25544, "start": "2026-09-25T00:00:00Z", "end": "2026-09-26T00:00:00Z"}
    body = {"satellites": [near, far], "station_ids": [station]}
    data = client.post("/api/v1/passes", json=body).json()
    assert [w["code"] for w in data["warnings"]] == ["elementsFarFromEpoch"]
