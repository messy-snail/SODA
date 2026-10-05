from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from soda.gp.models import normalize_omm
from soda.orbit.eclipse import SHADOW_RADIUS_M, eclipse_intervals_s, shadow_clearance_m
from soda.orbit.propagator import propagate, satellite_from_omm
from soda.orbit.sun import planets, sun_unit_itrs

RADIUS_M = SHADOW_RADIUS_M + 500_000
PERIOD_S = 5670.0
#: Half-angle of the shadow seen from the geocenter at this radius.
HALF_ANGLE = np.arcsin(SHADOW_RADIUS_M / RADIUS_M)


def circular_orbit(step_s: float, beta_deg: float = 0.0, turns: float = 1.0):
    """A circular orbit starting at local noon, with the Sun ``beta_deg`` off its plane."""
    count = int(round(turns * PERIOD_S / step_s)) + 1
    angle = 2 * np.pi * np.arange(count) * step_s / PERIOD_S
    position = RADIUS_M * np.column_stack([np.cos(angle), np.sin(angle), np.zeros(count)])
    beta = np.radians(beta_deg)
    sun = np.tile([np.cos(beta), 0.0, np.sin(beta)], (count, 1))
    return position, sun, np.ones(count, dtype=bool)


def test_clearance_sign_and_continuity():
    sun = np.array([[1.0, 0.0, 0.0]] * 4)
    position = RADIUS_M * np.array(
        [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [-1e-9, 1.0, 0.0]]
    )
    noon, midnight, dawn, just_past = shadow_clearance_m(position, sun)
    assert noon == pytest.approx(500_000)
    assert midnight == pytest.approx(-SHADOW_RADIUS_M)
    assert dawn == pytest.approx(just_past, abs=1e-3)


@pytest.mark.parametrize("step_s", [10.0, 30.0, 60.0])
def test_circular_orbit_matches_analytic_entry_and_exit(step_s):
    position, sun, valid = circular_orbit(step_s)
    enter, leave = eclipse_intervals_s(position, sun, valid, step_s)
    expected_enter = (np.pi - HALF_ANGLE) / (2 * np.pi) * PERIOD_S
    expected_leave = (np.pi + HALF_ANGLE) / (2 * np.pi) * PERIOD_S
    assert enter == pytest.approx(expected_enter, abs=1.5)
    assert leave == pytest.approx(expected_leave, abs=1.5)


def test_no_eclipse_when_the_sun_is_far_off_the_orbit_plane():
    position, sun, valid = circular_orbit(30.0, beta_deg=80.0)
    assert eclipse_intervals_s(position, sun, valid, 30.0) == []


def test_window_edges_clip_an_eclipse_in_progress():
    position, sun, valid = circular_orbit(30.0)
    dark = shadow_clearance_m(position, sun) < 0
    first, last = np.where(dark)[0][[0, -1]]
    cut = slice(first + 2, last - 1)
    intervals = eclipse_intervals_s(position[cut], sun[cut], valid[cut], 30.0)
    assert intervals == [0.0, (cut.stop - cut.start - 1) * 30.0]


def test_invalid_samples_break_an_interval():
    position, sun, valid = circular_orbit(30.0)
    dark = np.where(shadow_clearance_m(position, sun) < 0)[0]
    hole = int(dark[len(dark) // 2])
    valid[hole] = False
    position[hole] = np.nan
    intervals = eclipse_intervals_s(position, sun, valid, 30.0)
    assert len(intervals) == 4
    assert intervals[1] == (hole - 1) * 30.0 and intervals[2] == (hole + 1) * 30.0
    assert eclipse_intervals_s(position, sun, np.zeros_like(valid), 30.0) == []


def test_several_orbits_give_ascending_pairs():
    position, sun, valid = circular_orbit(60.0, turns=3.5)
    intervals = eclipse_intervals_s(position, sun, valid, 60.0)
    assert len(intervals) == 8
    assert intervals == sorted(intervals)


def test_agrees_with_skyfield_is_sunlit(iss_record, ephemeris_file):
    kernel = planets(ephemeris_file.parent)
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    ephemeris = propagate(omm, start, start + timedelta(hours=6), 30)
    sun = sun_unit_itrs(kernel, ephemeris.times)
    intervals = eclipse_intervals_s(ephemeris.fixed_m, sun, ephemeris.valid, 30)
    assert len(intervals) >= 6

    seconds = np.arange(len(ephemeris)) * 30.0
    enters, leaves = np.array(intervals[0::2]), np.array(intervals[1::2])
    dark = ((seconds[:, None] >= enters) & (seconds[:, None] <= leaves)).any(axis=1)
    sunlit = satellite_from_omm(omm).at(ephemeris.times).is_sunlit(kernel)
    assert int((dark == sunlit).sum()) <= 1
