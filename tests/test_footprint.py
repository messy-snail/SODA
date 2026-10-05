import numpy as np
import pytest

from soda.orbit.footprint import EARTH_RADIUS_KM, circle_lonlat, footprint_radius_km


@pytest.mark.parametrize(("elevation", "expected"), [(0, 2201), (10, 1344), (30, 603)])
def test_radius_at_400_km(elevation, expected):
    assert footprint_radius_km(400, elevation) == pytest.approx(expected, abs=2)


def test_radius_grows_with_altitude_and_shrinks_with_elevation():
    assert footprint_radius_km(800, 10) > footprint_radius_km(400, 10)
    assert footprint_radius_km(400, 20) < footprint_radius_km(400, 10)


def test_circle_is_closed_at_constant_distance():
    ring = np.array(circle_lonlat(36.35, 127.38, 1344, points=64))
    assert len(ring) == 65
    np.testing.assert_allclose(ring[0], ring[-1], atol=1e-6)
    lat1, lon1 = np.radians(36.35), np.radians(127.38)
    lat2, lon2 = np.radians(ring[:, 1]), np.radians(ring[:, 0])
    haversine = (
        np.sin((lat2 - lat1) / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    )
    distance = 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(haversine))
    np.testing.assert_allclose(distance, 1344, rtol=1e-4)
