"""HPOP integration: conservation laws, the J2 node drift, and agreement with SGP4."""

from datetime import UTC, datetime, timedelta
from math import cos, pi, radians, sin, sqrt

import numpy as np
import pytest

from soda.gp.models import normalize_omm
from soda.orbit.hpop import propagate as hpop
from soda.orbit.hpop.constants import (
    DEFAULT_AREA_M2,
    DEFAULT_CD,
    DEFAULT_CR,
    DEFAULT_MASS_KG,
    GM_EARTH,
    HPOP_MAX_EPOCH_GAP,
    HPOP_MAX_SPAN,
    R_EARTH,
)
from soda.orbit.hpop.environment import Environment, tau_of, times_from_tau
from soda.orbit.hpop.forces import ForceModel, Spacecraft
from soda.orbit.hpop.gravity import GravityField, normalized_coefficients
from soda.orbit.hpop.integrate import integrate
from soda.orbit.hpop.propagate import HpopOptions, InitialState, propagate_hpop
from soda.orbit.propagator import PropagationRequestError, propagate, timescale
from soda.orbit.sun import planets

EPOCH = timescale().utc(2026, 9, 16)
START = datetime(2026, 9, 16, tzinfo=UTC)
CRAFT = Spacecraft(500.0, 2.0, 2.2, 2.0, 1.3)
GRAVITY_ONLY = {"third_body": False, "drag": False, "srp": False}


@pytest.fixture(autouse=True)
def fresh_cache():
    hpop._cache.clear()


@pytest.fixture(scope="module")
def kernel(ephemeris_file):
    return planets(ephemeris_file.parent)


def _circular(altitude_m: float, inclination_deg: float) -> tuple[np.ndarray, np.ndarray]:
    r = R_EARTH + altitude_m
    speed = sqrt(GM_EARTH / r)
    i = radians(inclination_deg)
    return np.array([r, 0.0, 0.0]), np.array([0.0, speed * cos(i), speed * sin(i)])


def _gravity_force(degree: int, order: int, tau_max: float) -> ForceModel:
    environment = Environment(EPOCH, 0.0, tau_max, None)
    return ForceModel(
        GravityField(degree, order), environment, CRAFT, bulge_exponent=2.0, **GRAVITY_ONLY
    )


def test_two_body_orbit_conserves_energy_and_angular_momentum():
    position, velocity = _circular(700e3, 51.6)
    velocity = velocity * 1.05  # slightly eccentric
    semi_major = 1 / (2 / np.linalg.norm(position) - velocity @ velocity / GM_EARTH)
    period = 2 * pi * sqrt(semi_major**3 / GM_EARTH)
    trajectory = integrate(_gravity_force(0, 0, 10 * period), position, velocity, 0.0, 10 * period)
    tau = np.linspace(0.0, 10 * period, 400)
    r, v, valid = trajectory.sample(tau)
    assert valid.all()
    energy = 0.5 * np.einsum("ij,ij->i", v, v) - GM_EARTH / np.linalg.norm(r, axis=1)
    momentum = np.cross(r, v)
    # Sampled from the dense output, whose interpolation adds noise of a few 1e-9.
    assert np.abs(energy / energy[0] - 1).max() < 1e-8
    assert np.abs(momentum - momentum[0]).max() / np.linalg.norm(momentum[0]) < 1e-8
    # After a whole number of periods the satellite is back where it started.
    back, _, _ = trajectory.sample(np.array([10 * period]))
    assert np.linalg.norm(back[0] - position) < 1.0


def test_j2_turns_the_node_at_the_analytic_rate():
    inclination = 51.6
    position, velocity = _circular(500e3, inclination)
    span = 86400.0
    trajectory = integrate(_gravity_force(2, 0, span), position, velocity, 0.0, span)
    tau = np.linspace(0.0, span, 2000)
    r, v, _ = trajectory.sample(tau)
    momentum = np.cross(r, v)
    node = np.unwrap(np.arctan2(momentum[:, 0], -momentum[:, 1]))
    rate = np.polyfit(tau, node, 1)[0]

    j2 = -normalized_coefficients()[2, 0][0] * sqrt(5)
    radius = float(np.linalg.norm(position))
    mean_motion = sqrt(GM_EARTH / radius**3)
    expected = -1.5 * mean_motion * j2 * (R_EARTH / radius) ** 2 * cos(radians(inclination))
    assert expected < 0  # a prograde orbit regresses
    assert rate == pytest.approx(expected, rel=0.02)


def test_backward_and_forward_arcs_meet_at_the_epoch():
    position, velocity = _circular(600e3, 97.5)
    environment = Environment(EPOCH, -3000.0, 3000.0, None)
    force = ForceModel(GravityField(8), environment, CRAFT, bulge_exponent=2.0, **GRAVITY_ONLY)
    trajectory = integrate(force, position, velocity, -3000.0, 3000.0)
    r, v, valid = trajectory.sample(np.array([-3000.0, -1e-6, 0.0, 1e-6, 3000.0]))
    assert valid.all()
    np.testing.assert_allclose(r[2], position, atol=1e-9)
    np.testing.assert_allclose(r[1], r[3], atol=0.1)
    _, _, outside = trajectory.sample(np.array([-3000.1, 3000.1]))
    assert not outside.any()
    assert trajectory.covers(-100.0, 100.0) and not trajectory.covers(-100.0, 3001.0)

    one_sided = integrate(force, position, velocity, 100.0, 3000.0)
    assert one_sided.backward is None and one_sided.requested == (0.0, 3000.0)
    assert one_sided.sample(np.array([0.0, 100.0]))[2].all()


def test_time_grid_round_trips_to_microseconds():
    tau = np.array([-86400.0, 0.0, 0.123456, 7 * 86400.0])
    np.testing.assert_allclose(tau_of(EPOCH, times_from_tau(EPOCH, tau)), tau, atol=1e-6)


def test_hpop_stays_close_to_sgp4_for_a_day(iss_record, kernel):
    """Not a claim of accuracy: both start from the same state, so they should not diverge
    faster than the differences between their force models allow."""
    omm = normalize_omm(iss_record, "celestrak").omm
    state = hpop.state_from_omm(omm)
    start = state.epoch.utc_datetime()
    end = start + timedelta(days=1)
    ephemeris, model = propagate_hpop(state, start, end, 60, HpopOptions(), kernel)
    reference = propagate(omm, start, end, 60)
    separation = np.linalg.norm(ephemeris.fixed_m - reference.fixed_m, axis=1)
    assert ephemeris.valid.all()
    assert separation[0] < 1.0
    assert separation.max() < 10e3
    np.testing.assert_allclose(
        np.linalg.norm(ephemeris.fixed_m, axis=1),
        np.linalg.norm(ephemeris.inertial_m, axis=1),
        rtol=1e-9,
    )
    assert [w["code"] for w in ephemeris.warnings] == ["hpopAssumedSpacecraft"]
    assert model["gravity_degree"] == model["gravity_order"] == 8
    assert (model["initial_state"], model["integrator"]) == ("sgp4AtEpoch", "DOP853")
    assert model["spacecraft_source"] == "default"  # SRP has nothing but assumptions


def test_spacecraft_parameters_come_from_the_best_source(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    from_elements = hpop.state_from_omm(omm)
    craft, source = hpop.resolve_spacecraft(HpopOptions(srp=False), from_elements)
    assert source == "bstar"
    assert craft.cd * craft.drag_area_m2 / craft.mass_kg == pytest.approx(
        12.741621 * omm["BSTAR"], rel=1e-12
    )

    bare = InitialState(EPOCH, np.zeros(3), np.zeros(3), "stateVector")
    craft, source = hpop.resolve_spacecraft(HpopOptions(), bare)
    assert source == "default"
    assert craft == Spacecraft(
        DEFAULT_MASS_KG, DEFAULT_AREA_M2, DEFAULT_CD, DEFAULT_AREA_M2, DEFAULT_CR
    )

    stored = InitialState(
        EPOCH,
        np.zeros(3),
        np.zeros(3),
        "stateVector",
        spacecraft={"mass_kg": 100, "drag_area_m2": 1, "cd": 2, "srp_area_m2": 3, "cr": 1.5},
    )
    assert hpop.resolve_spacecraft(HpopOptions(), stored) == (
        Spacecraft(100, 1, 2, 3, 1.5),
        "state",
    )
    craft, source = hpop.resolve_spacecraft(HpopOptions(mass_kg=250, cr=1.1), stored)
    assert (craft.mass_kg, craft.cr, source) == (250, 1.1, "state")
    everything = HpopOptions(mass_kg=1, drag_area_m2=1, cd=1, srp_area_m2=1, cr=1)
    assert hpop.resolve_spacecraft(everything, bare)[1] == "request"
    # With drag and SRP off the spacecraft does not matter, so nothing is assumed.
    assert hpop.resolve_spacecraft(HpopOptions(**GRAVITY_ONLY), bare)[1] == "request"


def test_gravity_only_runs_without_the_ephemeris():
    position, velocity = _circular(700e3, 51.6)
    state = InitialState(EPOCH, position, velocity, "stateVector")
    options = HpopOptions(gravity_degree=4, **GRAVITY_ONLY)
    ephemeris, model = propagate_hpop(state, START, START + timedelta(hours=2), 60, options, None)
    assert ephemeris.valid.all() and ephemeris.warnings == []
    assert model["initial_state"] == "stateVector"
    np.testing.assert_allclose(ephemeris.inertial_m[0], position, atol=1e-6)
    assert ephemeris.alt_km.min() > 650 and ephemeris.alt_km.max() < 750
    with pytest.raises(ValueError):
        propagate_hpop(state, START, START + timedelta(hours=1), 60, HpopOptions(), None)


def test_reentry_marks_the_rest_invalid(kernel):
    position, velocity = _circular(130e3, 51.6)
    state = InitialState(EPOCH, position, velocity, "stateVector")
    options = HpopOptions(mass_kg=10, drag_area_m2=20, cd=2.2)
    ephemeris, _ = propagate_hpop(state, START, START + timedelta(hours=6), 60, options, kernel)
    invalid = (~ephemeris.valid).nonzero()[0]
    assert ephemeris.valid[0] and len(invalid) > 0
    assert list(invalid) == list(range(invalid[0], len(ephemeris)))  # everything after it
    assert ephemeris.alt_km[ephemeris.valid].min() > 99.0
    failure = [w for w in ephemeris.warnings if w["code"] == "hpopFailures"]
    assert failure and failure[0]["params"] == {"count": len(invalid)}


def test_window_limits():
    position, velocity = _circular(700e3, 51.6)
    state = InitialState(EPOCH, position, velocity, "stateVector")
    options = HpopOptions(gravity_degree=2, **GRAVITY_ONLY)
    hour = timedelta(hours=1)
    cases = [
        (START, START + HPOP_MAX_SPAN + hour, "hpopSpanTooLong"),
        (
            START + HPOP_MAX_EPOCH_GAP + hour,
            START + HPOP_MAX_EPOCH_GAP + 2 * hour,
            "hpopEpochTooFar",
        ),
        (
            START - HPOP_MAX_EPOCH_GAP - 2 * hour,
            START - HPOP_MAX_EPOCH_GAP - hour,
            "hpopEpochTooFar",
        ),
        (START + hour, START, "endBeforeStart"),
    ]
    for start, end, code in cases:
        with pytest.raises(PropagationRequestError) as caught:
            propagate_hpop(state, start, end, 600, options, None)
        assert caught.value.code == code
    assert (HPOP_MAX_SPAN.days, HPOP_MAX_EPOCH_GAP.days) == (7, 7)
    # A window around the epoch is fine however it straddles it.
    hpop.check_window(START, START - timedelta(days=3), START + timedelta(days=4))


def test_repeated_requests_reuse_the_integration(monkeypatch):
    position, velocity = _circular(700e3, 51.6)
    state = InitialState(EPOCH, position, velocity, "stateVector")
    options = HpopOptions(gravity_degree=2, **GRAVITY_ONLY)
    calls = []
    real = hpop.integrate
    monkeypatch.setattr(hpop, "integrate", lambda *args: calls.append(args[3:]) or real(*args))

    first, _ = propagate_hpop(state, START, START + timedelta(hours=2), 60, options, None)
    again, _ = propagate_hpop(state, START, START + timedelta(hours=2), 60, options, None)
    finer, _ = propagate_hpop(state, START, START + timedelta(hours=1), 10, options, None)
    assert len(calls) == 1
    np.testing.assert_array_equal(first.fixed_m, again.fixed_m)
    np.testing.assert_allclose(finer.fixed_m[::6], first.fixed_m[:61], atol=1e-6)

    # A longer window or another force model integrates again.
    propagate_hpop(state, START, START + timedelta(hours=3), 60, options, None)
    other = HpopOptions(gravity_degree=4, **GRAVITY_ONLY)
    propagate_hpop(state, START, START + timedelta(hours=1), 60, other, None)
    assert len(calls) == 3
    for index in range(hpop.CACHE_SIZE + 3):
        moved = InitialState(EPOCH, position + index, velocity, "stateVector")
        propagate_hpop(moved, START, START + timedelta(minutes=10), 60, options, None)
    assert len(hpop._cache) == hpop.CACHE_SIZE
