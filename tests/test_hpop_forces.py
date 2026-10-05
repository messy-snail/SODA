"""HPOP force model pieces against analytic and independently computed values."""

from math import cos, pi, radians, sin, sqrt

import numpy as np
import pytest

from soda.orbit.hpop import atmosphere
from soda.orbit.hpop.constants import AU_M, GM_EARTH, GM_SUN, R_EARTH, SOLAR_PRESSURE
from soda.orbit.hpop.forces import Spacecraft, drag, in_shadow, radiation_pressure, third_body
from soda.orbit.hpop.gravity import GravityField, normalized_coefficients

SUN = (AU_M, 0.0, 0.0)
CRAFT = Spacecraft(mass_kg=500.0, drag_area_m2=2.0, cd=2.2, srp_area_m2=4.0, cr=1.3)


def test_egm96_coefficients_are_the_published_ones():
    table = normalized_coefficients()
    assert len(table) == 229  # degrees 2..20 plus the central term
    assert table[0, 0] == (1.0, 0.0)
    assert table[2, 0] == (-0.484165371736e-03, 0.0)
    assert table[2, 2] == (0.243914352398e-05, -0.140016683654e-05)
    assert table[3, 0] == (0.957254173792e-06, 0.0)
    assert (20, 20) in table and (21, 0) not in table


def test_point_mass_and_j2_match_the_closed_form():
    x, y, z = 4.1e6, -3.9e6, 3.6e6
    r = sqrt(x * x + y * y + z * z)
    np.testing.assert_allclose(
        GravityField(0).acceleration(x, y, z), -GM_EARTH * np.array([x, y, z]) / r**3, rtol=1e-14
    )

    j2 = -normalized_coefficients()[2, 0][0] * sqrt(5)
    k = 1.5 * j2 * (R_EARTH / r) ** 2
    expected = (
        -GM_EARTH
        / r**3
        * np.array(
            [
                x * (1 + k * (1 - 5 * z * z / r**2)),
                y * (1 + k * (1 - 5 * z * z / r**2)),
                z * (1 + k * (3 - 5 * z * z / r**2)),
            ]
        )
    )
    np.testing.assert_allclose(GravityField(2, 0).acceleration(x, y, z), expected, rtol=1e-13)


def _potential(position: np.ndarray, degree: int) -> float:
    """EGM96 potential from fully normalized Legendre functions, written independently."""
    table = normalized_coefficients()
    x, y, z = position
    r = float(np.linalg.norm(position))
    sin_lat, cos_lat, lon = z / r, sqrt(x * x + y * y) / r, np.arctan2(y, x)
    p = np.zeros((degree + 1, degree + 1))
    p[0, 0] = 1.0
    for m in range(1, degree + 1):
        p[m, m] = sqrt(3.0 if m == 1 else (2 * m + 1) / (2 * m)) * cos_lat * p[m - 1, m - 1]
    for m in range(degree):
        p[m + 1, m] = sqrt(2 * m + 3) * sin_lat * p[m, m]
        for n in range(m + 2, degree + 1):
            a = sqrt((4 * n * n - 1) / (n * n - m * m))
            b = sqrt(((n - 1) ** 2 - m * m) / (4 * (n - 1) ** 2 - 1))
            p[n, m] = a * (sin_lat * p[n - 1, m] - b * p[n - 2, m])
    total = 0.0
    for n in range(degree + 1):
        for m in range(n + 1):
            c, s = table.get((n, m), (0.0, 0.0))
            total += (R_EARTH / r) ** n * p[n, m] * (c * cos(m * lon) + s * sin(m * lon))
    return GM_EARTH / r * total


@pytest.mark.parametrize("degree", [4, 20])
def test_acceleration_is_the_gradient_of_the_potential(degree):
    position = np.array([4.1e6, -3.9e6, 3.6e6])
    step = 20.0
    gradient = np.array(
        [
            (
                _potential(position + step * axis, degree)
                - _potential(position - step * axis, degree)
            )
            / (2 * step)
            for axis in np.eye(3)
        ]
    )
    acceleration = np.array(GravityField(degree).acceleration(*position))
    np.testing.assert_allclose(acceleration, gradient, rtol=2e-9)
    # The higher-degree terms are really in there: they differ from J2 alone.
    j2_only = np.array(GravityField(2, 0).acceleration(*position))
    assert 1e-6 < np.linalg.norm(acceleration - j2_only) < 1e-3


def test_order_limits_the_tesseral_terms():
    zonal = GravityField(8, 0).acceleration(4.1e6, -3.9e6, 3.6e6)
    full = GravityField(8).acceleration(4.1e6, -3.9e6, 3.6e6)
    assert zonal != full
    with pytest.raises(ValueError):
        GravityField(21)
    with pytest.raises(ValueError):
        GravityField(4, 5)


def test_harris_priester_density():
    apex = (cos(atmosphere.BULGE_LAG_RAD), sin(atmosphere.BULGE_LAG_RAD), 0.0)

    def at(height_km: float, sign: float, exponent: float = 2.0) -> float:
        r = R_EARTH + height_km * 1000.0
        position = (sign * r * apex[0], sign * r * apex[1], 0.0)
        return atmosphere.density(position, SUN, exponent)

    # Table nodes: the day-side maximum at the bulge apex, the night-side minimum opposite.
    assert at(400, 1) == pytest.approx(7.492e-12, rel=1e-12)
    assert at(400, -1) == pytest.approx(2.249e-12, rel=1e-12)
    assert at(100, 1) == at(100, -1) == pytest.approx(4.974e-07, rel=1e-12)
    # Exponential in height between nodes.
    assert at(410, -1) == pytest.approx(sqrt(2.249e-12 * 1.558e-12), rel=1e-9)
    # Outside the table: nothing above, the lowest row below.
    assert at(1000, 1) == 0.0 and at(2000, 1) == 0.0
    assert at(50, 1) == pytest.approx(4.974e-07, rel=1e-12)

    # A quarter of the way round, the bulge term is cos^n(45 deg).
    r = R_EARTH + 400e3
    side = (-r * apex[1], r * apex[0], 0.0)
    for exponent in (2.0, 6.0):
        expected = 2.249e-12 + (7.492e-12 - 2.249e-12) * 0.5 ** (exponent / 2)
        assert atmosphere.density(side, SUN, exponent) == pytest.approx(expected, rel=1e-12)
    assert atmosphere.bulge_exponent(0.0) == 2.0
    assert atmosphere.bulge_exponent(pi / 2) == pytest.approx(6.0)
    assert atmosphere.bulge_exponent(radians(51.6)) == pytest.approx(4.457, abs=1e-3)


def test_height_uses_the_ellipsoid():
    assert atmosphere.height_km(R_EARTH + 400e3, 0.0, 0.0) == pytest.approx(400.0)
    polar_radius = R_EARTH * (1 - 1 / 298.257223563)
    assert atmosphere.height_km(0.0, 0.0, polar_radius + 400e3) == pytest.approx(400.0, abs=0.01)


def test_drag_opposes_the_velocity_relative_to_the_atmosphere():
    r = R_EARTH + 400e3
    position = (r, 0.0, 0.0)
    # Moving exactly with the atmosphere there is no drag.
    co_rotating = (0.0, 7.2921158553e-5 * r, 0.0)
    assert drag(position, co_rotating, SUN, CRAFT, 2.0) == pytest.approx((0.0, 0.0, 0.0), abs=1e-20)
    ax, ay, az = drag(position, (0.0, 7600.0, 0.0), SUN, CRAFT, 2.0)
    density = atmosphere.density(position, SUN, 2.0)
    relative = 7600.0 - 7.2921158553e-5 * r
    assert (ax, az) == (0.0, 0.0)
    assert ay == pytest.approx(-0.5 * 2.2 * 2.0 / 500.0 * density * relative**2, rel=1e-12)
    assert drag((R_EARTH + 1500e3, 0.0, 0.0), (0.0, 7000.0, 0.0), SUN, CRAFT, 2.0) == (0, 0, 0)


def test_cylindrical_shadow():
    r = 7.0e6
    assert not in_shadow((r, 0.0, 0.0), SUN)  # sunward side
    assert in_shadow((-r, 0.0, 0.0), SUN)  # straight behind the Earth
    assert in_shadow((-r, 0.0, R_EARTH - 1.0), SUN)
    assert not in_shadow((-r, 0.0, R_EARTH + 1.0), SUN)  # behind, but outside the cylinder
    assert not in_shadow((0.0, r, 0.0), SUN)  # terminator plane counts as lit

    assert radiation_pressure((-r, 0.0, 0.0), SUN, CRAFT) == (0.0, 0.0, 0.0)
    ax, ay, az = radiation_pressure((0.0, r, 0.0), SUN, CRAFT)
    magnitude = sqrt(ax * ax + ay * ay + az * az)
    assert magnitude == pytest.approx(SOLAR_PRESSURE * 1.3 * 4.0 / 500.0, rel=1e-6)
    assert ax < 0 and ay > 0  # pushed away from the Sun


def test_third_body_is_a_tidal_acceleration():
    assert third_body((0.0, 0.0, 0.0), SUN, GM_SUN) == (0.0, 0.0, 0.0)
    r = 7.0e6
    towards = third_body((r, 0.0, 0.0), SUN, GM_SUN)
    away = third_body((-r, 0.0, 0.0), SUN, GM_SUN)
    across = third_body((0.0, r, 0.0), SUN, GM_SUN)
    tide = GM_SUN * r / AU_M**3
    # Stretched along the line to the body, squeezed across it.
    assert towards[0] == pytest.approx(2 * tide, rel=1e-3)
    assert away[0] == pytest.approx(-2 * tide, rel=1e-3)
    assert across[1] == pytest.approx(-tide, rel=1e-3)
