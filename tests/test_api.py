"""Core API endpoints: health, catalog, propagation and swath."""

import pytest

START = "2026-09-16T00:00:00Z"


def test_health_and_unknown_api(client):
    assert client.get("/api/v1/health").json()["status"] == "ok"
    assert client.get("/api/v1/nope").status_code == 404
    assert client.get("/").status_code == 503


def test_catalog_flow(client, upstream_requests):
    assert client.post("/api/v1/gp/stations/refresh").json() == {
        "group": "stations",
        "result": "ok",
    }
    assert client.post("/api/v1/gp/stations/refresh").json()["result"] == "skipped"
    assert client.get("/api/v1/gp/unknown").status_code == 404

    found = client.get("/api/v1/catalog/search", params={"q": "iss"}).json()
    assert found[0]["norad_id"] == 25544 and found[0]["category"] == "LEO"

    detail = client.get("/api/v1/catalog/25544").json()
    assert detail["groups"] == ["stations"]
    assert detail["tle"][0].startswith("1 25544U")
    assert client.get("/api/v1/catalog/77777").status_code == 404

    bulk = client.get("/api/v1/gp/stations")
    assert bulk.json()[0]["OBJECT_NAME"] == "ISS (ZARYA)"
    cached = client.get("/api/v1/gp/stations", headers={"If-None-Match": bulk.headers["etag"]})
    assert cached.status_code == 304

    status = client.get("/api/v1/status").json()
    assert status["objects"] == 1
    fetch = next(f for f in status["fetches"] if f["key"] == "group:stations")
    assert fetch["last_status"] == "ok" and fetch["next_allowed_at"].endswith("Z")
    assert len(upstream_requests) == 2


def test_propagate(client):
    body = {"norad_id": 25544, "start": START, "end": "2026-09-16T01:00:00Z", "step_s": 60}
    data = client.post("/api/v1/propagate", json=body).json()
    assert data["count"] == 61
    assert len(data["fixed_m"]) == len(data["inertial_m"]) == 61 * 3
    assert len(data["lat_deg"]) == 61
    assert data["start"] == "2026-09-16T00:00:00.000Z"
    assert data["element_set"]["source"] == "celestrak"
    assert data["orbit"]["category"] == "LEO"
    assert data["invalid"] == [] and data["warnings"] == []
    assert (data["propagator"], data["force_model"]) == ("sgp4", None)
    eclipse = data["eclipse_s"]
    # One eclipse begins inside the hour and is clipped at the end of the window.
    assert len(eclipse) == 2 and 0 < eclipse[0] < eclipse[1] == 3600
    # One beta angle per pair of consecutive samples, the last sample having no successor.
    offsets, beta = data["beta_offset_s"], data["beta_deg"]
    assert len(offsets) == len(beta) == 60 and (offsets[0], offsets[-1]) == (0, 3540)
    assert all(-90 <= value <= 90 for value in beta)
    assert max(beta) - min(beta) < 0.5
    explicit = client.post("/api/v1/propagate", json={**body, "propagator": "sgp4"}).json()
    assert explicit["fixed_m"] == data["fixed_m"]


def test_propagator_must_fit_the_source(client):
    body = {"norad_id": 25544, "start": START, "end": "2026-09-16T01:00:00Z", "step_s": 60}
    for path, extra in (("/api/v1/propagate", {}), ("/api/v1/swath", {"sensor": {"swath_km": 12}})):
        response = client.post(path, json={**body, **extra, "propagator": "ephemeris"})
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "propagatorNotAllowed"
        assert detail["params"] == {"kind": "omm", "propagator": "ephemeris"}
    unknown = client.post("/api/v1/propagate", json={**body, "propagator": "kepler"})
    assert unknown.json()["detail"]["code"] == "invalidRequest"


def test_propagate_validation(client):
    too_long = {"norad_id": 25544, "start": START, "end": "2026-11-01T00:00:00Z", "step_s": 600}
    response = client.post("/api/v1/propagate", json=too_long)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "spanTooLong"
    missing = {"norad_id": 77777, "start": START, "end": "2026-09-16T01:00:00Z"}
    assert client.post("/api/v1/propagate", json=missing).status_code == 404


def test_swath(client):
    body = {
        "norad_id": 25544,
        "start": START,
        "end": "2026-09-16T03:00:00Z",
        "step_s": 30,
        "sensor": {"swath_km": 12, "max_off_nadir_deg": 30, "min_sun_elev_deg": 10},
    }
    data = client.post("/api/v1/swath", json=body).json()
    assert data["nadir_width_km"] == pytest.approx(12, rel=0.01)
    assert data["for_width_km"] > 400
    segment = data["segments"][0]
    assert len(segment["left"]) == 2 * (segment["i1"] - segment["i0"] + 1)
    both = dict(body, sensor={"swath_km": 12, "fov_deg": 1})
    assert client.post("/api/v1/swath", json=both).status_code == 422


def test_invalid_request_names_the_offending_fields(client):
    response = client.post("/api/v1/stations", json={"name": "", "lat_deg": 999, "lon_deg": 0})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "invalidRequest"
    assert sorted(detail["params"]["fields"]) == ["lat_deg", "name"]


def test_catalog_search_category(bare_client, iss_record):
    from soda.gp.models import normalize_omm

    geo = dict(iss_record, NORAD_CAT_ID=40001, OBJECT_NAME="GEO SAT", MEAN_MOTION=1.0027)
    elements = [normalize_omm(r, "celestrak") for r in (iss_record, geo)]
    bare_client.app.state.gp.store.upsert_latest(elements, elements[0].epoch)

    def search(**params):
        return bare_client.get("/api/v1/catalog/search", params=params)

    found = search(category="GEO").json()
    assert [(e["norad_id"], e["category"]) for e in found] == [(40001, "GEO")]
    assert [e["norad_id"] for e in search(q="zarya", category="LEO").json()] == [25544]
    assert search(q="zarya", category="GEO").json() == []
    both = bare_client.get(
        "/api/v1/catalog/search", params=[("category", "LEO"), ("category", "GEO")]
    ).json()
    assert sorted(e["norad_id"] for e in both) == [25544, 40001]

    invalid = search(category="leo")
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "invalidRequest"
