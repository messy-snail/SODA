"""State vectors through the API: CRUD, OPM import, HPOP propagation, and what refuses them."""

from math import sqrt

import numpy as np
import pytest

from soda.orbit.hpop import propagate as hpop
from soda.orbit.hpop.constants import GM_EARTH, R_EARTH

URL = "/api/v1/custom-states"
RADIUS = R_EARTH + 700e3
SPEED = sqrt(GM_EARTH / RADIUS)
STATE = {
    "name": "내 위성",
    "epoch": "2026-09-16T00:00:00Z",
    "frame": "GCRF",
    "x_m": RADIUS,
    "y_m": 0.0,
    "z_m": 0.0,
    "vx_m_s": 0.0,
    "vy_m_s": SPEED * 0.6,
    "vz_m_s": SPEED * 0.8,
    "mass_kg": 120.0,
    "drag_area_m2": 0.9,
    "cd": 2.3,
    "srp_area_m2": 1.2,
    "cr": 1.4,
}
WINDOW = {"start": "2026-09-16T00:00:00Z", "end": "2026-09-16T02:00:00Z", "step_s": 60}
OPM = f"""CCSDS_OPM_VERS = 2.0
OBJECT_NAME = OPM-SAT
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
EPOCH = 2026-09-16T00:00:00
X = {RADIUS / 1000!r}
Y = 0
Z = 0
X_DOT = 0
Y_DOT = {SPEED * 0.6 / 1000!r}
Z_DOT = {SPEED * 0.8 / 1000!r}
MASS = 300
"""


@pytest.fixture(autouse=True)
def fresh_cache():
    hpop._cache.clear()


def _create(client, **changes) -> dict:
    response = client.post(URL, json={**STATE, **changes})
    assert response.status_code == 201, response.json()
    return response.json()


def test_create_list_get_delete(bare_client):
    created = _create(bare_client)
    assert created["state_id"] > 0 and created["norad_id"] == 0
    assert (created["name"], created["source"], created["frame"]) == ("내 위성", "user", "GCRF")
    assert created["epoch"] == "2026-09-16T00:00:00.000Z"
    assert created["tle"] is None and created["omm"] is None and created["groups"] == []
    assert created["input_format"] == "form"
    assert created["state"]["x_m"] == RADIUS and created["state"]["mass_kg"] == 120.0
    orbit = created["orbit"]
    assert orbit["osculating"] is True and orbit["category"] == "LEO"
    assert orbit["perigee_alt_km"] == pytest.approx(700, abs=1e-3)

    assert bare_client.get(f"{URL}/{created['state_id']}").json() == created
    assert bare_client.get(URL).json() == [
        {
            "id": created["state_id"],
            "name": "내 위성",
            "epoch": "2026-09-16T00:00:00.000Z",
            "frame": "GCRF",
            "input_format": "form",
            "category": "LEO",
            "created_at": created["created_at"],
        }
    ]

    clash = bare_client.post(URL, json=STATE)
    assert (clash.status_code, clash.json()["detail"]["code"]) == (409, "stateNameTaken")
    assert bare_client.delete(f"{URL}/{created['state_id']}").status_code == 204
    for response in (
        bare_client.delete(f"{URL}/{created['state_id']}"),
        bare_client.get(f"{URL}/{created['state_id']}"),
    ):
        assert (response.status_code, response.json()["detail"]["code"]) == (404, "stateNotFound")


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"x_m": 6.4e6}, "stateVectorInvalid"),
        ({"vy_m_s": 20000.0}, "stateVectorInvalid"),
        ({"frame": "MCI"}, "stateVectorInvalid"),
        ({"name": ""}, "invalidRequest"),
        ({"mass_kg": 0}, "invalidRequest"),
        ({"epoch": "soon"}, "invalidRequest"),
    ],
)
def test_create_errors(bare_client, change, code):
    response = bare_client.post(URL, json={**STATE, **change})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


def test_import_opm(bare_client):
    response = bare_client.post(f"{URL}/import", content=OPM.encode())
    assert response.status_code == 201, response.json()
    data = response.json()
    assert (data["name"], data["object_id"], data["frame"]) == ("OPM-SAT", "2026-001A", "EME2000")
    assert data["input_format"] == "opm"
    assert data["state"]["x_m"] == pytest.approx(RADIUS, abs=1e-6)
    assert data["state"]["mass_kg"] == 300.0 and "cd" not in data["state"]

    named = bare_client.post(f"{URL}/import", params={"name": "다른 이름"}, content=OPM.encode())
    assert named.json()["name"] == "다른 이름"
    for content, status in ((b"garbage", 422), (b"\xff\xfe", 422), (b"x" * (1024 * 1024 + 1), 413)):
        bad = bare_client.post(f"{URL}/import", content=content)
        assert (bad.status_code, bad.json()["detail"]["code"]) == (status, "stateVectorInvalid")
    again = bare_client.post(f"{URL}/import", content=OPM.encode())
    assert (again.status_code, again.json()["detail"]["code"]) == (409, "stateNameTaken")


def test_propagate_a_state_with_hpop(client):
    created = _create(client)
    body = {"state_id": created["state_id"], **WINDOW}
    response = client.post("/api/v1/propagate", json=body)
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["propagator"] == "hpop"  # the default for a state vector
    assert data["count"] == 121 and data["invalid"] == [] and data["warnings"] == []
    element_set = data["element_set"]
    assert (element_set["state_id"], element_set["custom_id"]) == (created["state_id"], None)
    assert (element_set["name"], element_set["norad_id"]) == ("내 위성", 0)
    assert element_set["tle"] is None and element_set["omm"] is None
    assert element_set["age_days"] == 0
    assert data["orbit"] == created["orbit"]
    model = data["force_model"]
    assert (model["initial_state"], model["spacecraft_source"]) == ("stateVector", "state")
    assert (model["mass_kg"], model["drag_area_m2"], model["cd"]) == (120.0, 0.9, 2.3)
    assert (model["srp_area_m2"], model["cr"]) == (1.2, 1.4)
    np.testing.assert_allclose(data["inertial_m"][:3], [RADIUS, 0, 0], atol=0.1)
    assert min(data["alt_km"]) > 680 and max(data["alt_km"]) < 730

    # A state has no mean elements, so SGP4 cannot take it.
    sgp4 = client.post("/api/v1/propagate", json={**body, "propagator": "sgp4"})
    assert sgp4.status_code == 422
    assert sgp4.json()["detail"]["code"] == "propagatorNotAllowed"
    assert sgp4.json()["detail"]["params"] == {"kind": "opm", "propagator": "sgp4"}

    swath = client.post("/api/v1/swath", json={**body, "sensor": {"swath_km": 12}})
    assert swath.status_code == 200, swath.json()
    assert swath.json()["nadir_width_km"] == pytest.approx(12, rel=0.01)

    missing = client.post("/api/v1/propagate", json={"state_id": 999, **WINDOW})
    assert (missing.status_code, missing.json()["detail"]["code"]) == (404, "stateNotFound")


def test_spacecraft_defaults_are_reported(client):
    bare = {key: STATE[key] for key in STATE if key.endswith(("_m", "_m_s"))}
    created = client.post(URL, json={"name": "bare", "epoch": STATE["epoch"], **bare}).json()
    data = client.post("/api/v1/propagate", json={"state_id": created["state_id"], **WINDOW}).json()
    assert data["force_model"]["spacecraft_source"] == "default"
    assert [w["code"] for w in data["warnings"]] == ["hpopAssumedSpacecraft"]


def test_tools_that_need_elements_refuse_a_state(client):
    state_id = _create(client)["state_id"]
    station_id = client.get("/api/v1/stations").json()[0]["id"]
    ref = {"state_id": state_id, "start": WINDOW["start"], "end": WINDOW["end"]}
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
        assert detail["code"] == "sourceNeedsElements", path
        assert detail["params"] == {"kind": "state"}

    both = client.post(
        "/api/v1/propagate", json={"state_id": state_id, "norad_id": 25544, **WINDOW}
    )
    assert both.json()["detail"]["code"] == "satelliteRefInvalid"


def test_states_are_browsable(bare_client):
    _create(bare_client)
    tables = {t["name"]: t for t in bare_client.get("/api/v1/database/tables").json()}
    assert tables["custom_states"]["count"] == 1
    page = bare_client.get("/api/v1/database/tables/custom_states").json()
    assert page["rows"][0]["state"]["mass_kg"] == 120.0  # the JSON column comes back parsed
