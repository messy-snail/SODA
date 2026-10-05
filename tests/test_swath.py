from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from soda.gp.models import normalize_omm
from soda.orbit.propagator import propagate
from soda.orbit.swath import (
    MEAN_RADIUS_M,
    WGS84_A,
    Sensor,
    compute_swath,
    daylight_mask,
    edge_points,
    fov_from_swath_km,
    split_runs,
    surface_lonlat,
)


def equator_pass(altitude_km: float):
    """One sample above (0°, 0°) moving due north."""
    position = np.array([[WGS84_A + altitude_km * 1000, 0.0, 0.0]])
    velocity = np.array([[0.0, 0.0, 7000.0]])
    return position, velocity, np.array([0.0]), np.array([0.0])


def arc_km(a: np.ndarray, b: np.ndarray) -> float:
    chord = np.linalg.norm(a - b, axis=1)
    return float(2 * MEAN_RADIUS_M * np.arcsin(chord / (2 * MEAN_RADIUS_M))[0] / 1000)


@pytest.mark.parametrize("angle_deg", [0.5, 2.0, 5.0])
def test_small_angle_width_matches_flat_approximation(angle_deg):
    position, velocity, lat, lon = equator_pass(500)
    left, right = edge_points(position, velocity, lat, lon, angle_deg)
    expected = 2 * 500 * np.tan(np.radians(angle_deg))
    assert arc_km(left, right) == pytest.approx(expected, rel=0.01)


def test_left_is_west_when_moving_north():
    position, velocity, lat, lon = equator_pass(500)
    left, right = edge_points(position, velocity, lat, lon, 10)
    (left_lon, _), (right_lon, _) = surface_lonlat(left)[0], surface_lonlat(right)[0]
    assert left_lon < 0 < right_lon


def test_swath_km_round_trip():
    fov = fov_from_swath_km(120, 500)
    position, velocity, lat, lon = equator_pass(500)
    left, right = edge_points(position, velocity, lat, lon, fov / 2)
    assert arc_km(left, right) == pytest.approx(120, rel=0.005)


def test_look_beyond_limb_clamps_to_horizon():
    position, velocity, lat, lon = equator_pass(500)
    left, right = edge_points(position, velocity, lat, lon, 85)
    horizon_km = MEAN_RADIUS_M / 1000 * np.arccos(MEAN_RADIUS_M / (MEAN_RADIUS_M + 500e3))
    width = arc_km(left, right)
    assert np.isfinite(left).all() and np.isfinite(right).all()
    assert 1.5 * horizon_km < width < 2 * horizon_km


def test_split_runs_shares_boundaries_and_skips_invalid():
    valid = np.array([True, True, True, True, False, True, True, True])
    daylight = np.array([True, True, False, False, False, False, False, True])
    assert split_runs(valid, daylight) == [(0, 2, True), (2, 3, False), (5, 7, False)]


def test_daylight_mask_uses_sun_elevation():
    sun = np.array([[1.0, 0.0, 0.0]] * 3)
    mask = daylight_mask(np.array([0, 0, 0]), np.array([0, 85, 180]), sun, 10)
    assert mask.tolist() == [True, False, False]


def sun_synchronous(iss_record: dict) -> dict:
    record = dict(iss_record, INCLINATION=97.4, MEAN_MOTION=15.2, NORAD_CAT_ID=99001)
    return normalize_omm(record, "test").omm


def test_polar_and_dateline_edges_stay_continuous(iss_record):
    start = datetime(2026, 9, 16, tzinfo=UTC)
    ephemeris = propagate(sun_synchronous(iss_record), start, start + timedelta(days=1), 30)
    left, right = edge_points(
        ephemeris.fixed_m, ephemeris.fixed_velocity_m_s, ephemeris.lat_deg, ephemeris.lon_deg, 30
    )
    for edge in (left, right):
        steps_km = np.linalg.norm(np.diff(edge, axis=0), axis=1) / 1000
        assert steps_km.max() < 400
        lonlat = surface_lonlat(edge)
        assert np.all(np.abs(lonlat[:, 0]) <= 180)
        assert np.all(np.abs(lonlat[:, 1]) <= 90)
    assert ephemeris.lat_deg.max() > 80
    assert (np.abs(np.diff(ephemeris.lon_deg)) > 300).any()


def test_compute_swath_segments(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    ephemeris = propagate(omm, start, start + timedelta(hours=3), 30)
    fov = fov_from_swath_km(12, float(ephemeris.alt_km.mean()))
    sun = np.tile([1.0, 0.0, 0.0], (len(ephemeris), 1))
    swath = compute_swath(ephemeris, Sensor(fov, 30, 10), sun)

    assert swath.nadir_width_km == pytest.approx(12, rel=0.01)
    assert 450 < swath.for_width_km < 600
    assert 0 < swath.daylight_fraction < 1
    kinds = {segment.kind for segment in swath.segments}
    assert kinds == {"nadir", "for"}
    nadir = [s for s in swath.segments if s.kind == "nadir"]
    assert nadir[0].i0 == 0 and nadir[-1].i1 == len(ephemeris) - 1
    assert all(a.i1 == b.i0 for a, b in zip(nadir, nadir[1:], strict=False))
    assert all(a.daylight != b.daylight for a, b in zip(nadir, nadir[1:], strict=False))
    assert all(len(s.left) == s.i1 - s.i0 + 1 for s in swath.segments)


def test_nadir_only_sensor(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    ephemeris = propagate(omm, start, start + timedelta(minutes=10), 30)
    sun = np.tile([1.0, 0.0, 0.0], (len(ephemeris), 1))
    swath = compute_swath(ephemeris, Sensor(1.5, 0, 10), sun)
    assert swath.for_width_km is None
    assert {segment.kind for segment in swath.segments} == {"nadir"}
