"""Equivalent circuit battery: the current it settles on and the charge it integrates."""

import math

import numpy as np
import pytest

from soda.orbit.battery import (
    TRACE_BUCKETS,
    Battery,
    BatteryCurveError,
    run_circuit,
)
from soda.orbit.power import PowerSpec, Timeline, integrate, integrate_circuit


def pack(**overrides) -> Battery:
    """Seven cells of a flat 4 V curve, 10 Ah: 280 Wh at open circuit."""
    fields = {
        "cells_series": 7,
        "capacity_ah": 10.0,
        "resistance_ohm": 0.07,
        "max_charge_a": 100.0,
        "cell_max_v": 4.2,
        "cell_min_v": 3.0,
        "ocv_soc": (0.0, 1.0),
        "ocv_cell_v": (4.0, 4.0),
    }
    return Battery(**{**fields, **overrides})


def schedule(*segments: tuple[float, float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Edges, generation and load from ``(duration_s, generation_w, load_w)`` segments."""
    columns = zip(*segments, strict=True)
    durations, generation, load = (np.array(column, dtype=float) for column in columns)
    return np.concatenate(([0.0], np.cumsum(durations))), generation, load


def test_curve_is_interpolated_and_sets_the_nominal_energy():
    battery = pack(ocv_soc=(0.0, 0.5, 1.0), ocv_cell_v=(3.0, 3.8, 4.2))
    assert battery.ocv(0.25) == pytest.approx(7 * 3.4)
    assert battery.ocv(-1) == pytest.approx(7 * 3.0) and battery.ocv(2) == pytest.approx(7 * 4.2)
    assert battery.nominal_wh == pytest.approx(7 * 10 * (3.4 * 0.5 + 4.0 * 0.5))
    assert pack().nominal_wh == pytest.approx(280)
    assert (pack().max_voltage_v, pack().min_voltage_v) == pytest.approx((29.4, 21.0))


@pytest.mark.parametrize(
    "bad",
    [
        {"ocv_soc": (0.0, 1.0), "ocv_cell_v": (4.0, 3.9)},
        {"ocv_soc": (0.1, 1.0)},
        {"ocv_soc": (0.0, 0.9)},
        {"ocv_soc": (0.0, 0.5, 0.5, 1.0), "ocv_cell_v": (3.0, 3.5, 3.6, 4.0)},
        {"ocv_soc": (0.0,), "ocv_cell_v": (4.0,)},
        {"ocv_soc": tuple(np.linspace(0, 1, 33)), "ocv_cell_v": (4.0,) * 33},
        {"cell_min_v": 4.2},
    ],
)
def test_unusable_curves_and_limits_are_rejected(bad):
    with pytest.raises(BatteryCurveError) as error:
        pack(**bad)
    assert error.value.code == "batteryCurveInvalid"


def test_discharge_current_solves_the_power_balance():
    battery = pack()
    current, voltage, unmet, shunted = battery.flow(0.5, -200.0, 0.9, 0.8)
    assert current > 0 and unmet == 0 and shunted == 0
    assert voltage == pytest.approx(28.0 - current * 0.07)
    # The converter loses a fifth, so the terminals give 250 W for 200 W at the bus.
    assert voltage * current == pytest.approx(250.0)


def test_charging_is_capped_by_the_current_limit_and_the_rest_is_shunted():
    battery = pack(max_charge_a=5.0)
    current, voltage, unmet, shunted = battery.flow(0.5, 400.0, 0.9, 1.0)
    assert current == -5.0 and unmet == 0
    assert voltage == pytest.approx(28.0 + 5.0 * 0.07)
    assert shunted == pytest.approx((400.0 * 0.9 - voltage * 5.0) / 0.9)


def test_low_voltage_cut_off_leaves_load_unserved():
    battery = pack(cell_min_v=3.9)
    current, voltage, unmet, _ = battery.flow(0.5, -500.0, 1.0, 1.0)
    assert voltage == pytest.approx(7 * 3.9)
    assert current == pytest.approx((28.0 - 27.3) / 0.07)
    assert unmet == pytest.approx(500.0 - voltage * current)
    assert battery.flow(0.0, -10.0, 1.0, 1.0)[0] == 0.0
    assert battery.flow(1.0, 10.0, 1.0, 1.0)[0] == 0.0


def test_without_resistance_a_flat_curve_is_the_energy_balance():
    edges, generation, load = schedule((1800, 0, 60), (900, 200, 60), (600, 0, 150))
    timeline = Timeline(edges, generation, load, [], 0.0)
    spec = PowerSpec(
        array_w=200,
        capacity_wh=280,
        initial_soc=0.5,
        charge_efficiency=0.9,
        discharge_efficiency=0.85,
        battery=pack(resistance_ohm=0.0),
    )
    energy = integrate(timeline, PowerSpec(**{**spec.__dict__, "battery": None}))
    circuit = integrate_circuit(timeline, spec)
    assert circuit.capacity_wh == pytest.approx(280)
    assert circuit.final_soc == pytest.approx(energy.final_soc, abs=1e-9)
    assert circuit.min_soc == pytest.approx(energy.min_soc, abs=1e-9)
    assert circuit.loss_wh == 0 and circuit.unmet_wh == 0
    assert circuit.generated_wh == pytest.approx(energy.generated_wh)
    assert circuit.consumed_wh == pytest.approx(energy.consumed_wh)
    assert circuit.min_voltage_v == circuit.max_voltage_v == pytest.approx(28.0)


def test_constant_voltage_charging_approaches_full_exponentially():
    # A linear curve that ends at the charge voltage: the current is (V_max - OCV) / R.
    battery = pack(
        cells_series=1,
        capacity_ah=2.0,
        resistance_ohm=0.25,
        ocv_soc=(0.0, 1.0),
        ocv_cell_v=(3.2, 4.2),
        cell_max_v=4.2,
        cell_min_v=3.0,
    )
    tau = 0.25 * 2.0 * 3600 / (4.2 - 3.2)
    edges, generation, load = schedule((2 * tau, 1e4, 0))
    trace = run_circuit(battery, edges, generation, load, 0.2, 1.0, 1.0)
    expected = 1 - 0.8 * np.exp(-trace.full_time_s / tau)
    assert np.abs(trace.full_soc - expected).max() < 1e-5
    assert trace.max_voltage_v == pytest.approx(4.2)
    assert trace.max_charge_a == pytest.approx((4.2 - 3.2) * 0.8 / 0.25)
    assert trace.shunted_wh > 0 and trace.unmet_wh == 0


def test_resistance_costs_energy_both_ways():
    edges, generation, load = schedule((1800, 0, 150), (1800, 200, 0))
    lossless = run_circuit(pack(resistance_ohm=0.0), edges, generation, load, 0.5, 1.0, 1.0)
    lossy = run_circuit(pack(), edges, generation, load, 0.5, 1.0, 1.0)
    assert lossy.loss_wh > 0 and lossless.loss_wh == 0
    assert lossy.full_soc[-1] < lossless.full_soc[-1]
    assert lossy.min_voltage_v < 28.0 < lossy.max_voltage_v
    # Charge balance: the heat is what separates the two runs, at the open-circuit voltage.
    assert (lossless.full_soc[-1] - lossy.full_soc[-1]) * 280 == pytest.approx(
        lossy.loss_wh, rel=1e-3
    )


def test_trace_is_thinned_but_keeps_the_extremes_and_the_unserved_span():
    battery = pack(capacity_ah=1.0, cell_min_v=3.9)
    edges, generation, load = schedule((40_000, 0, 1), (20_000, 0, 600), (40_000, 400, 0))
    trace = run_circuit(battery, edges, generation, load, 1.0, 1.0, 1.0)
    assert len(trace.full_time_s) > 9000
    assert len(trace.time_s) <= 2 * TRACE_BUCKETS + 2
    assert trace.time_s[0] == 0 and trace.time_s[-1] == 100_000
    assert trace.min_soc == trace.full_soc.min() == 0.0
    start, end = trace.unmet_s[0], trace.unmet_s[-1]
    assert 40_000 <= start < end <= 60_000 and trace.unmet_wh > 0
    assert math.isclose(trace.full_soc[-1], 1.0)
