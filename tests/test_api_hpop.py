"""HPOP through the API: the propagator choice, its options, limits, and the swath cache."""

import json

import numpy as np
import pytest

from soda.orbit.hpop import propagate as hpop

# The ISS fixture epoch is 2026-09-15T21:14:23Z.
WINDOW = {"start": "2026-09-16T00:00:00Z", "end": "2026-09-16T01:00:00Z", "step_s": 60}
ISS = {"norad_id": 25544, **WINDOW}
GRAVITY_ONLY = {"third_body": False, "drag": False, "srp": False}


@pytest.fixture(autouse=True)
def fresh_cache():
    hpop._cache.clear()


def _separation_m(a: dict, b: dict) -> np.ndarray:
    first = np.array(a["fixed_m"]).reshape(-1, 3)
    second = np.array(b["fixed_m"]).reshape(-1, 3)
    return np.linalg.norm(first - second, axis=1)


def test_propagate_with_hpop(client):
    sgp4 = client.post("/api/v1/propagate", json=ISS).json()
    response = client.post("/api/v1/propagate", json={**ISS, "propagator": "hpop"})
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["propagator"] == "hpop"
    assert data["count"] == 61 and data["invalid"] == []
    assert data["element_set"] == sgp4["element_set"] and data["orbit"] == sgp4["orbit"]
    assert [w["code"] for w in data["warnings"]] == ["hpopAssumedSpacecraft"]
    assert data["warnings"][0]["params"] == {"source": "default"}
    assert 1.0 < _separation_m(data, sgp4).max() < 2000.0

    model = data["force_model"]
    assert model == {
        "gravity_degree": 8,
        "gravity_order": 8,
        "third_body": True,
        "drag": True,
        "srp": True,
        "mass_kg": 500.0,
        "drag_area_m2": pytest.approx(500.0 * 12.741621 * 0.00012172288 / 2.2),
        "cd": 2.2,
        "srp_area_m2": model["drag_area_m2"],
        "cr": 1.3,
        "spacecraft_source": "default",
        "initial_state": "sgp4AtEpoch",
        "integrator": "DOP853",
        "rtol": 1e-9,
        "atol_m": 1e-3,
    }


def test_hpop_options_shape_the_force_model(client):
    options = {
        "gravity_degree": 20,
        "gravity_order": 0,
        "srp": False,
        "mass_kg": 420000,
        "drag_area_m2": 1600,
        "cd": 2.0,
    }
    body = {**ISS, "propagator": "hpop", "hpop": options}
    data = client.post("/api/v1/propagate", json=body).json()
    model = data["force_model"]
    assert (model["gravity_degree"], model["gravity_order"], model["srp"]) == (20, 0, False)
    assert (model["mass_kg"], model["drag_area_m2"], model["cd"]) == (420000, 1600, 2.0)
    assert model["spacecraft_source"] == "request" and data["warnings"] == []

    default = client.post("/api/v1/propagate", json={**ISS, "propagator": "hpop"}).json()
    assert _separation_m(data, default).max() > 0.01
    # The options are only read by HPOP.
    ignored = client.post("/api/v1/propagate", json={**ISS, "hpop": options}).json()
    assert (ignored["propagator"], ignored["force_model"]) == ("sgp4", None)


def test_gravity_only_hpop_needs_no_ephemeris(bare_client, iss_record, monkeypatch):
    def unavailable(_directory):
        raise OSError("no ephemeris in this test")

    # Without this the loader would download DE421 into the empty data directory.
    monkeypatch.setattr("soda.api.orbit.planets", unavailable)
    created = bare_client.post(
        "/api/v1/custom-elements", json={"name": "ISS", "text": json.dumps(iss_record)}
    ).json()
    body = {"custom_id": created["custom_id"], **WINDOW, "propagator": "hpop"}
    with_bodies = bare_client.post("/api/v1/propagate", json=body)
    assert with_bodies.status_code == 503
    assert with_bodies.json()["detail"]["code"] == "ephemerisUnavailable"
    alone = bare_client.post("/api/v1/propagate", json={**body, "hpop": GRAVITY_ONLY})
    assert alone.status_code == 200, alone.json()
    assert alone.json()["invalid"] == []
    # The orbit needs no Sun; only the eclipse intervals are dropped, with a warning.
    assert alone.json()["eclipse_s"] is None
    assert [warning["code"] for warning in alone.json()["warnings"]] == ["eclipseUnavailable"]


@pytest.mark.parametrize(
    ("change", "code", "params"),
    [
        ({"end": "2026-09-24T00:00:00Z", "step_s": 600}, "hpopSpanTooLong", {"days": 7}),
        (
            {"start": "2026-09-25T00:00:00Z", "end": "2026-09-25T01:00:00Z"},
            "hpopEpochTooFar",
            {"days": 7},
        ),
        ({"end": "2026-09-15T00:00:00Z"}, "endBeforeStart", {}),
        ({"hpop": {"gravity_degree": 21}}, "invalidRequest", None),
        ({"hpop": {"gravity_degree": 1}}, "invalidRequest", None),
        ({"hpop": {"gravity_degree": 4, "gravity_order": 5}}, "invalidRequest", None),
        ({"hpop": {"mass_kg": 0}}, "invalidRequest", None),
        ({"hpop": {"cr": 5}}, "invalidRequest", None),
    ],
)
def test_hpop_limits(client, change, code, params):
    body = {**ISS, "propagator": "hpop", "hpop": GRAVITY_ONLY, **change}
    response = client.post("/api/v1/propagate", json=body)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == code
    if params is not None:
        assert detail["params"] == params


def test_far_from_the_epoch_hpop_warns_like_sgp4(client):
    body = {
        **ISS,
        "start": "2026-09-22T00:00:00Z",
        "end": "2026-09-24T00:00:00Z",
        "step_s": 600,
        "propagator": "hpop",
        "hpop": GRAVITY_ONLY,
    }
    data = client.post("/api/v1/propagate", json=body).json()
    assert [w["code"] for w in data["warnings"]] == ["elementsFarFromEpoch"]
    assert data["warnings"][0]["params"] == {"days": 8}


def test_swath_reuses_the_propagated_trajectory(client, monkeypatch):
    calls = []
    real = hpop.integrate
    monkeypatch.setattr(hpop, "integrate", lambda *args: calls.append(1) or real(*args))
    body = {**ISS, "propagator": "hpop"}
    assert client.post("/api/v1/propagate", json=body).status_code == 200
    widths = []
    for swath_km in (12, 30):
        response = client.post("/api/v1/swath", json={**body, "sensor": {"swath_km": swath_km}})
        assert response.status_code == 200, response.json()
        widths.append(response.json()["nadir_width_km"])
    assert widths == [pytest.approx(12, rel=0.01), pytest.approx(30, rel=0.01)]
    assert len(calls) == 1
