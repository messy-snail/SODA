"""Coverage endpoint."""

START = "2026-09-16T00:00:00Z"
END = "2026-09-18T00:00:00Z"
KOREA = {"west_deg": 125, "south_deg": 33, "east_deg": 130, "north_deg": 38.5}


def cover(client, **overrides):
    body = {
        "norad_id": 25544,
        **KOREA,
        "nx": 5,
        "ny": 4,
        "start": START,
        "end": END,
        "max_roll_deg": 30,
        **overrides,
    }
    return client.post("/api/v1/coverage", json=body)


def test_events_are_listed_cell_after_cell(client):
    response = cover(client)
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["element_set"]["norad_id"] == 25544
    assert (data["start"], data["end"]) == ("2026-09-16T00:00:00.000Z", "2026-09-18T00:00:00.000Z")
    assert data["grid"] == {**KOREA, "nx": 5, "ny": 4}
    assert len(data["counts"]) == 20
    assert sum(data["counts"]) == len(data["offset_s"]) > 0
    assert all(isinstance(value, int) and 0 <= value <= 172800 for value in data["offset_s"])
    first = data["offset_s"][: data["counts"][0]]
    assert first == sorted(first)
    assert data["warnings"] == []


def test_pointing_changes_the_events(client):
    narrow = cover(client, max_roll_deg=5).json()
    wide = cover(client).json()
    agile = cover(client, mode="roll_pitch", max_pitch_deg=30).json()
    assert sum(narrow["counts"]) < sum(wide["counts"])
    # A window with pitch to spare nearly always holds the pitch 0 crossing as well.
    assert abs(sum(agile["counts"]) - sum(wide["counts"])) <= 2


def test_limits_and_bad_boxes_are_refused(client):
    too_large = cover(client, nx=51, ny=50)
    assert too_large.status_code == 422
    detail = too_large.json()["detail"]
    assert (detail["code"], detail["params"]) == ("coverageGridTooLarge", {"max": 2500})

    def code(**overrides):
        return cover(client, **overrides).json()["detail"]["code"]

    assert code(end="2026-10-17T00:00:00Z") == "accessWindowTooLong"
    assert code(end=START) == "endBeforeStart"
    for bad in ({"south_deg": 40}, {"east_deg": 125}, {"nx": 0}, {"max_roll_deg": 0}):
        assert code(**bad) == "invalidRequest"


def test_a_state_vector_has_no_elements_to_search_with(client):
    body = {**KOREA, "nx": 2, "ny": 2, "start": START, "end": END, "max_roll_deg": 30}
    response = client.post("/api/v1/coverage", json={**body, "state_id": 1})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "sourceNeedsElements"
