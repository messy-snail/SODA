"""Imported ephemerides through the API: upload, interpolation, and what refuses them."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from soda.gp.models import normalize_omm
from soda.orbit import oem
from soda.orbit.oem import write_oem
from soda.orbit.propagator import propagate

URL = "/api/v1/custom-ephemerides"
START = datetime(2026, 9, 16, tzinfo=UTC)
WINDOW = {"start": "2026-09-16T00:30:00Z", "end": "2026-09-16T01:30:00Z", "step_s": 30}


@pytest.fixture
def oem_text(iss_record) -> str:
    omm = normalize_omm(iss_record, "celestrak").omm
    return write_oem(propagate(omm, START, START + timedelta(hours=3), 60), "ISS OEM", "1998-067A")


def _upload(client, text: str, **params) -> dict:
    response = client.post(URL, content=text.encode(), params=params)
    assert response.status_code == 201, response.json()
    return response.json()


def test_upload_list_get_delete(bare_client, oem_text):
    created = _upload(bare_client, oem_text)
    assert created["ephemeris_id"] > 0 and created["norad_id"] == 0
    assert (created["name"], created["object_id"], created["frame"]) == (
        "ISS OEM",
        "1998-067A",
        "GCRF",
    )
    assert created["epoch"] == created["span_start"] == "2026-09-16T00:00:00.000Z"
    assert created["span_end"] == "2026-09-16T03:00:00.000Z"
    assert created["sample_count"] == 181
    assert created["tle"] is None and created["omm"] is None
    assert created["orbit"]["osculating"] is True and created["orbit"]["category"] == "LEO"

    assert bare_client.get(f"{URL}/{created['ephemeris_id']}").json() == created
    assert bare_client.get(URL).json() == [
        {
            "id": created["ephemeris_id"],
            "name": "ISS OEM",
            "start": "2026-09-16T00:00:00.000Z",
            "stop": "2026-09-16T03:00:00.000Z",
            "sample_count": 181,
            "frame": "GCRF",
            "created_at": created["created_at"],
        }
    ]
    assert _upload(bare_client, oem_text, name="다른 이름")["name"] == "다른 이름"

    clash = bare_client.post(URL, content=oem_text.encode())
    assert (clash.status_code, clash.json()["detail"]["code"]) == (409, "ephemerisNameTaken")
    assert bare_client.delete(f"{URL}/{created['ephemeris_id']}").status_code == 204
    for response in (
        bare_client.delete(f"{URL}/{created['ephemeris_id']}"),
        bare_client.get(f"{URL}/{created['ephemeris_id']}"),
    ):
        assert (response.status_code, response.json()["detail"]["code"]) == (
            404,
            "ephemerisNotFound",
        )


def test_upload_errors(bare_client, oem_text, monkeypatch):
    cases = (
        (b"garbage", 422, "oemInvalid"),
        (b"\xff\xfe", 422, "oemInvalid"),
        (oem_text.replace("TIME_SYSTEM = UTC", "TIME_SYSTEM = GPS").encode(), 422, None),
        (oem_text.replace("REF_FRAME = GCRF", "REF_FRAME = MCI").encode(), 422, None),
    )
    codes = []
    for content, status, code in cases:
        response = bare_client.post(URL, content=content)
        assert response.status_code == status
        codes.append(response.json()["detail"]["code"])
        assert code is None or codes[-1] == code
    assert codes[2:] == ["oemTimeSystemUnsupported", "oemFrameUnsupported"]

    monkeypatch.setattr(oem, "MAX_OEM_SAMPLES", 100)
    many = bare_client.post(URL, content=oem_text.encode())
    assert (many.status_code, many.json()["detail"]["code"]) == (422, "oemTooManySamples")
    monkeypatch.setattr("soda.api.custom_ephemerides.MAX_OEM_BYTES", 1024)
    large = bare_client.post(URL, content=oem_text.encode())
    assert (large.status_code, large.json()["detail"]["code"]) == (413, "oemTooLarge")
    assert bare_client.get(URL).json() == []


def test_propagating_an_ephemeris_interpolates_it(client, oem_text):
    ephemeris_id = _upload(client, oem_text)["ephemeris_id"]
    body = {"ephemeris_id": ephemeris_id, **WINDOW}
    response = client.post("/api/v1/propagate", json=body)
    assert response.status_code == 200, response.json()
    data = response.json()
    assert (data["propagator"], data["force_model"]) == ("ephemeris", None)
    assert data["count"] == 121 and data["invalid"] == [] and data["warnings"] == []
    element_set = data["element_set"]
    assert (element_set["ephemeris_id"], element_set["state_id"]) == (ephemeris_id, None)
    assert (element_set["custom_id"], element_set["norad_id"]) == (None, 0)
    assert element_set["age_days"] is None and element_set["tle"] is None
    assert element_set["span_end"] == "2026-09-16T03:00:00.000Z"

    # It is the orbit the file was made from, sampled between the file's own times.
    sgp4 = client.post("/api/v1/propagate", json={"norad_id": 25544, **WINDOW}).json()
    separation = np.linalg.norm(
        np.array(data["fixed_m"]).reshape(-1, 3) - np.array(sgp4["fixed_m"]).reshape(-1, 3), axis=1
    )
    assert separation.max() < 1.0

    swath = client.post("/api/v1/swath", json={**body, "sensor": {"swath_km": 12}})
    assert swath.status_code == 200, swath.json()
    assert swath.json()["nadir_width_km"] == pytest.approx(12, rel=0.01)

    for propagator in ("sgp4", "hpop"):
        refused = client.post("/api/v1/propagate", json={**body, "propagator": propagator})
        assert refused.status_code == 422
        assert refused.json()["detail"]["code"] == "propagatorNotAllowed"
        assert refused.json()["detail"]["params"] == {"kind": "oem", "propagator": propagator}


def test_window_and_the_file_span(client, oem_text):
    ephemeris_id = _upload(client, oem_text)["ephemeris_id"]
    late = {"start": "2026-09-16T02:30:00Z", "end": "2026-09-16T03:30:00Z", "step_s": 60}
    data = client.post("/api/v1/propagate", json={"ephemeris_id": ephemeris_id, **late}).json()
    assert data["invalid"] == list(range(31, 61))
    assert [w["code"] for w in data["warnings"]] == ["ephemerisOutsideSpan"]

    after = {"start": "2026-09-17T00:00:00Z", "end": "2026-09-17T01:00:00Z"}
    missed = client.post("/api/v1/propagate", json={"ephemeris_id": ephemeris_id, **after})
    assert missed.status_code == 422
    detail = missed.json()["detail"]
    assert detail["code"] == "ephemerisNoOverlap"
    assert detail["params"] == {"start": "2026-09-16T00:00:00Z", "end": "2026-09-16T03:00:00Z"}

    unknown = client.post("/api/v1/propagate", json={"ephemeris_id": 999, **WINDOW})
    assert (unknown.status_code, unknown.json()["detail"]["code"]) == (404, "ephemerisNotFound")


def test_tools_that_need_elements_refuse_an_ephemeris(client, oem_text):
    ephemeris_id = _upload(client, oem_text)["ephemeris_id"]
    station_id = client.get("/api/v1/stations").json()[0]["id"]
    ref = {"ephemeris_id": ephemeris_id, "start": WINDOW["start"], "end": WINDOW["end"]}
    requests = (
        ("/api/v1/passes", {"satellites": [ref], "station_ids": [station_id]}),
        (
            "/api/v1/access",
            {**ref, "targets": [{"id": "a", "lat_deg": 0, "lon_deg": 0}], "max_roll_deg": 30},
        ),
        ("/api/v1/tmtc/session", {**ref, "station_ids": [station_id]}),
    )
    for path, body in requests:
        response = client.post(path, json=body)
        assert response.status_code == 422, path
        detail = response.json()["detail"]
        assert (detail["code"], detail["params"]) == ("sourceNeedsElements", {"kind": "ephemeris"})


def test_browsing_shows_the_size_not_the_samples(bare_client, oem_text):
    _upload(bare_client, oem_text)
    tables = {t["name"]: t for t in bare_client.get("/api/v1/database/tables").json()}
    assert tables["custom_ephemerides"]["count"] == 1
    assert "samples_bytes" in tables["custom_ephemerides"]["columns"]
    assert "samples" not in tables["custom_ephemerides"]["columns"]
    row = bare_client.get("/api/v1/database/tables/custom_ephemerides").json()["rows"][0]
    assert row["samples_bytes"] == 181 * 7 * 8
    assert row["meta"]["segments"] == [[0, 181]] and row["sample_count"] == 181
    # A user data export leaves ephemerides out; the database download carries them.
    assert "custom_ephemerides" not in bare_client.get("/api/v1/database/export").json()
