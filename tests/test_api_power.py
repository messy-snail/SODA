"""Power budget endpoint."""

START = "2026-09-16T00:00:00Z"
END = "2026-09-16T06:00:00Z"
POWER = {"array_w": 200, "capacity_wh": 300, "base_w": 90, "imaging_w": 60, "downlink_w": 50}


def budget(client, **extra):
    body = {"norad_id": 25544, "start": START, "end": END, "step_s": 30, "power": POWER, **extra}
    return client.post("/api/v1/power", json=body)


def test_power_reports_the_energy_balance(client):
    data = budget(client).json()
    assert data["start"] == "2026-09-16T00:00:00.000Z" and data["span_s"] == 6 * 3600
    assert data["capacity_wh"] == 300
    assert data["model"] == "energy" and data["voltage_v"] is None
    assert len(data["time_s"]) == len(data["soc"]) >= 4
    assert data["time_s"][0] == 0 and data["time_s"][-1] == data["span_s"]
    assert data["time_s"] == sorted(data["time_s"])
    assert all(0 <= value <= 1 for value in data["soc"])
    assert len(data["eclipse_s"]) >= 6 and len(data["eclipse_s"]) % 2 == 0
    assert 0.2 < data["eclipse_fraction"] < 0.45
    assert data["max_dod"] == round(1 - data["min_soc"], 5) > 0
    assert -90 <= data["beta_start_deg"] <= 90 and -90 <= data["beta_end_deg"] <= 90
    assert data["off_sun_s"] == 0 and data["unmet_wh"] == 0
    stored = (data["final_soc"] - 1) * 300
    assert data["generated_wh"] - data["shunted_wh"] - data["consumed_wh"] >= stored


def test_activities_cost_energy(client):
    quiet = budget(client).json()
    shots = [{"start": "2026-09-16T00:10:00Z", "end": "2026-09-16T00:10:20Z", "roll_deg": 30}]
    station = client.get("/api/v1/stations").json()[0]["id"]
    contacts = [
        {"start": "2026-09-16T01:00:00Z", "end": "2026-09-16T01:09:00Z", "station_id": station}
    ]
    busy = budget(client, shots=shots, contacts=contacts).json()
    assert busy["consumed_wh"] > quiet["consumed_wh"]
    assert busy["off_sun_s"] <= 140
    for attitude in ("nadir", "station"):
        power = {**POWER, "contact_attitude": attitude}
        turned = budget(client, contacts=contacts, power=power).json()
        assert turned["generated_wh"] <= quiet["generated_wh"]


def test_power_validation(client):
    contacts = [{"start": START, "end": END, "station_id": 9999}]
    tracked = budget(client, contacts=contacts, power={**POWER, "contact_attitude": "station"})
    assert tracked.status_code == 404
    assert tracked.json()["detail"]["code"] == "stationNotFound"
    assert budget(client, contacts=contacts).status_code == 200

    many = [{"start": START, "end": START}] * 5001
    response = budget(client, shots=many)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "powerIntervalsTooMany"

    assert budget(client, power={**POWER, "array_w": 0}).status_code == 422
    assert budget(client, power={**POWER, "contact_attitude": "yaw"}).status_code == 422


def test_coarse_step_warns_when_the_array_leaves_the_sun(client):
    shots = [{"start": "2026-09-16T00:10:00Z", "end": "2026-09-16T00:10:20Z", "roll_deg": 30}]
    fine = budget(client, shots=shots).json()
    coarse = budget(client, shots=shots, step_s=300).json()
    codes = [warning["code"] for warning in coarse["warnings"]]
    assert "powerCoarseStep" not in [warning["code"] for warning in fine["warnings"]]
    assert "powerCoarseStep" in codes or coarse["off_sun_s"] == 0


def test_starting_soc_can_apply_inside_the_run(client):
    whole = budget(client).json()
    assert whole["soc_at"] == "2026-09-16T00:00:00.000Z"
    power = {**POWER, "initial_soc_pct": 60}
    late = budget(client, soc_at="2026-09-16T03:00:00Z", power=power).json()
    assert late["soc_at"] == "2026-09-16T03:00:00.000Z"
    assert late["time_s"][0] == 3 * 3600 and late["soc"][0] == 0.6
    assert late["time_s"][-1] == late["span_s"] == whole["span_s"]
    assert late["eclipse_s"] == whole["eclipse_s"]
    assert late["generated_wh"] < whole["generated_wh"]

    outside = budget(client, soc_at="2026-09-16T06:00:00Z")
    assert outside.status_code == 422
    assert outside.json()["detail"]["code"] == "powerStartOutsideRun"


BATTERY = {
    "cells_series": 7,
    "capacity_ah": 12,
    "resistance_ohm": 0.07,
    "max_charge_a": 6,
    "cell_max_v": 4.2,
    "cell_min_v": 3.0,
    "ocv": [
        {"soc_pct": 0, "cell_v": 3.0},
        {"soc_pct": 20, "cell_v": 3.55},
        {"soc_pct": 80, "cell_v": 4.0},
        {"soc_pct": 100, "cell_v": 4.2},
    ],
}


def test_equivalent_circuit_reports_voltage_and_current(client):
    data = budget(client, power={**POWER, "battery": BATTERY}).json()
    assert data["model"] == "circuit"
    count = len(data["time_s"])
    assert len(data["soc"]) == len(data["voltage_v"]) == len(data["current_a"]) == count
    assert all(0 <= value <= 1 for value in data["soc"])
    # The area under the curve, not the capacity_wh of the energy model.
    assert abs(data["capacity_wh"] - 7 * 12 * (3.275 * 0.2 + 3.775 * 0.6 + 4.1 * 0.2)) < 1e-3
    assert 21 <= data["min_voltage_v"] <= data["max_voltage_v"] <= 7 * 4.2 + 1e-6
    assert 0 < data["max_charge_a"] <= 6 and data["max_discharge_a"] > 0
    assert data["loss_wh"] > 0 and data["min_soc"] < 1
    assert min(data["current_a"]) < 0 < max(data["current_a"])


def test_battery_validation(client):
    falling = {**BATTERY, "ocv": [{"soc_pct": 0, "cell_v": 4.0}, {"soc_pct": 100, "cell_v": 3.0}]}
    response = budget(client, power={**POWER, "battery": falling})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "batteryCurveInvalid"
    assert (
        budget(client, power={**POWER, "battery": {**BATTERY, "cells_series": 0}}).status_code
        == 422
    )
    one = {**BATTERY, "ocv": BATTERY["ocv"][:1]}
    assert budget(client, power={**POWER, "battery": one}).status_code == 422


def test_power_beta_is_the_ends_of_the_propagated_series(client):
    body = {"norad_id": 25544, "start": START, "end": END, "step_s": 30}
    series = client.post("/api/v1/propagate", json=body).json()["beta_deg"]
    data = budget(client).json()
    assert (data["beta_start_deg"], data["beta_end_deg"]) == (series[0], series[-1])
