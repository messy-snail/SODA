"""User-supplied elements: CRUD, use in propagate/swath/passes, and the groups listing."""

import json

import pytest
from conftest import one_satellite

from soda.gp.celestrak import GROUP_ORDER
from soda.gp.element_files import MAX_ELEMENT_FILE_BYTES
from soda.gp.models import normalize_omm
from soda.orbit.propagator import tle_lines

URL = "/api/v1/custom-elements"
IMPORT_URL = f"{URL}/import"
START = "2026-09-16T00:00:00Z"
WINDOW = {"start": START, "end": "2026-09-16T01:00:00Z", "step_s": 60}


@pytest.fixture
def iss_tle(iss_record) -> tuple[str, str]:
    lines = tle_lines(normalize_omm(iss_record, "celestrak").omm)
    assert lines is not None
    return lines


def _create(client, name: str, text: str) -> dict:
    response = client.post(URL, json={"name": name, "text": text})
    assert response.status_code == 201, response.json()
    return response.json()


def test_create_from_tle_omm_and_three_lines(bare_client, iss_tle, iss_record):
    two = _create(bare_client, "두 줄", "\n".join(iss_tle))
    assert two["custom_id"] > 0 and two["input_format"] == "tle"
    assert (two["name"], two["norad_id"], two["source"]) == ("두 줄", 25544, "user")
    assert two["object_id"] == "1998-067A"
    assert two["epoch"] == "2026-09-15T21:14:23.428Z"
    assert two["groups"] == []
    assert list(two["tle"]) == list(iss_tle)
    assert two["orbit"]["category"] == "LEO"
    assert two["omm"]["OBJECT_NAME"] == "NORAD 25544"
    assert two["created_at"].endswith("Z")

    three = _create(bare_client, "세 줄", "0 ISS (ZARYA)\n" + "\n".join(iss_tle))
    assert three["omm"]["OBJECT_NAME"] == "ISS (ZARYA)"
    omm = _create(bare_client, "OMM", json.dumps([iss_record]))
    assert omm["input_format"] == "omm"
    assert omm["omm"] == normalize_omm(iss_record, "user").omm

    listed = bare_client.get(URL).json()
    assert [item["id"] for item in listed] == [
        two["custom_id"],
        three["custom_id"],
        omm["custom_id"],
    ]
    assert listed[0] == {
        "id": two["custom_id"],
        "name": "두 줄",
        "norad_id": 25544,
        "epoch": "2026-09-15T21:14:23.428Z",
        "input_format": "tle",
        "category": "LEO",
        "created_at": two["created_at"],
    }
    assert bare_client.get(f"{URL}/{two['custom_id']}").json() == two


def test_create_errors(bare_client, iss_tle):
    invalid = bare_client.post(URL, json={"name": "x", "text": "garbage"})
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "customElementsInvalid"
    for body in ({"name": "", "text": "x"}, {"name": "x" * 61, "text": "x"}, {"name": "x"}):
        response = bare_client.post(URL, json=body)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalidRequest"
    too_long = bare_client.post(URL, json={"name": "x", "text": "x" * 20001})
    assert too_long.json()["detail"]["code"] == "invalidRequest"

    _create(bare_client, "ISS", "\n".join(iss_tle))
    clash = bare_client.post(URL, json={"name": "ISS", "text": "\n".join(iss_tle)})
    assert clash.status_code == 409
    assert clash.json()["detail"]["code"] == "customElementNameTaken"


def test_delete(bare_client, iss_tle):
    created = _create(bare_client, "ISS", "\n".join(iss_tle))
    assert bare_client.delete(f"{URL}/{created['custom_id']}").status_code == 204
    for response in (
        bare_client.delete(f"{URL}/{created['custom_id']}"),
        bare_client.get(f"{URL}/{created['custom_id']}"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "customElementNotFound"
    assert bare_client.get(URL).json() == []


def test_propagate_with_custom_elements(bare_client, iss_tle):
    created = _create(bare_client, "ISS", "\n".join(iss_tle))
    body = {"custom_id": created["custom_id"], **WINDOW}
    response = bare_client.post("/api/v1/propagate", json=body)
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["count"] == 61 and data["invalid"] == []
    # Without the ephemeris the orbit still propagates; only the eclipse intervals are dropped.
    assert data["eclipse_s"] is None and data["beta_offset_s"] is None and data["beta_deg"] is None
    assert [warning["code"] for warning in data["warnings"]] == ["eclipseUnavailable"]
    element_set = data["element_set"]
    assert element_set["custom_id"] == created["custom_id"]
    assert (element_set["source"], element_set["name"]) == ("user", "ISS")
    assert list(element_set["tle"]) == list(iss_tle)


@pytest.mark.parametrize(
    "ref", [{}, {"norad_id": 25544, "custom_id": 1}, {"norad_id": None, "custom_id": None}]
)
def test_satellite_ref_needs_exactly_one_id(bare_client, ref):
    for path, extra in (
        ("/api/v1/propagate", {}),
        ("/api/v1/swath", {"sensor": {"swath_km": 12}}),
        ("/api/v1/passes", {"station_ids": [1]}),
    ):
        body = {**ref, **WINDOW, **extra}
        if path.endswith("passes"):
            body = {"satellites": [{**ref, **WINDOW}], **extra}
        response = bare_client.post(path, json=body)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "satelliteRefInvalid"


def test_unknown_custom_id(bare_client):
    response = bare_client.post("/api/v1/propagate", json={"custom_id": 999, **WINDOW})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "customElementNotFound"


def test_groups_listing(bare_client):
    groups = bare_client.get("/api/v1/catalog/groups").json()
    assert [group["name"] for group in groups] == list(GROUP_ORDER)
    assert all(group["cached_count"] == 0 and group["fetched_at"] is None for group in groups)
    assert {group["name"] for group in groups if group["auto_refresh"]} == {"active"}


# The tests below need the DE421 ephemeris (the ``client`` fixture skips without it).


def test_custom_elements_match_the_catalog(client, iss_record):
    created = _create(client, "OMM", json.dumps(iss_record))
    custom = client.post("/api/v1/propagate", json={"custom_id": created["custom_id"], **WINDOW})
    catalog = client.post("/api/v1/propagate", json={"norad_id": 25544, **WINDOW})
    assert catalog.json()["element_set"]["custom_id"] is None
    assert custom.json()["fixed_m"] == catalog.json()["fixed_m"]


def test_swath_and_passes_with_custom_elements(client, iss_tle):
    custom_id = _create(client, "ISS", "\n".join(iss_tle))["custom_id"]
    swath = client.post(
        "/api/v1/swath",
        json={"custom_id": custom_id, **WINDOW, "sensor": {"swath_km": 12}},
    )
    assert swath.status_code == 200, swath.json()
    assert swath.json()["nadir_width_km"] == pytest.approx(12, rel=0.01)

    station_id = client.get("/api/v1/stations").json()[0]["id"]
    body = {
        "custom_id": custom_id,
        "station_ids": [station_id],
        "start": START,
        "end": "2026-09-17T00:00:00Z",
    }
    passes = client.post("/api/v1/passes", json=one_satellite(body))
    assert passes.status_code == 200, passes.json()
    data = passes.json()["satellites"][0]
    assert data["element_set"]["custom_id"] == custom_id
    assert data["element_set"]["source"] == "user"
    assert data["results"][0]["passes"]


def test_groups_listing_after_a_refresh(client):
    assert client.post("/api/v1/gp/stations/refresh").json()["result"] == "ok"
    groups = {group["name"]: group for group in client.get("/api/v1/catalog/groups").json()}
    assert groups["stations"]["cached_count"] == 1
    assert groups["stations"]["fetched_at"].endswith("Z")
    assert groups["active"]["cached_count"] == 0 and groups["active"]["fetched_at"] is None


def test_import_file(bare_client, iss_tle, iss_record):
    twin = {**iss_record, "OBJECT_NAME": "TWIN", "NORAD_CAT_ID": 40000}
    text = "\n".join(["ISS (ZARYA)", *iss_tle, *iss_tle, "junk"])
    first = bare_client.post(IMPORT_URL, content=text.encode())
    assert first.status_code == 200, first.json()
    data = first.json()
    assert (data["format"], data["total"]) == ("tle", 3)
    assert [item["name"] for item in data["created"]] == ["ISS (ZARYA)", "NORAD 25544"]
    assert data["created"][0]["input_format"] == "tle"
    assert data["skipped"] == [{"index": 2, "name": "junk", "reason": "invalid"}]
    assert bare_client.get(URL).json() == data["created"]

    second = bare_client.post(IMPORT_URL, content=json.dumps([iss_record, twin]).encode())
    data = second.json()
    assert (data["format"], data["total"]) == ("json", 2)
    assert [item["name"] for item in data["created"]] == ["TWIN"]
    assert data["skipped"] == [{"index": 0, "name": "ISS (ZARYA)", "reason": "duplicate"}]
    assert len(bare_client.get(URL).json()) == 3

    custom_id = data["created"][0]["id"]
    propagated = bare_client.post("/api/v1/propagate", json={"custom_id": custom_id, **WINDOW})
    assert propagated.status_code == 200, propagated.json()


def test_import_errors(bare_client):
    for content, status, code in (
        (b"", 422, "elementFileUnreadable"),
        (b"\xff\xfe\x00bad", 422, "elementFileUnreadable"),
        (b"CCSDS_OEM_VERS = 2.0\n", 422, "elementFileWrongKind"),
        (b"[" + b"{}," * 500 + b"{}]", 422, "elementFileTooManyRecords"),
        (b"x" * (MAX_ELEMENT_FILE_BYTES + 1), 413, "elementFileTooLarge"),
    ):
        response = bare_client.post(IMPORT_URL, content=content)
        assert response.status_code == status, code
        assert response.json()["detail"]["code"] == code
    assert bare_client.get(URL).json() == []
