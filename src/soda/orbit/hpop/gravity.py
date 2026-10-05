"""Earth's gravity from the EGM96 spherical harmonics, in the Earth-fixed frame.

The acceleration is summed with Cunningham's recursion for the functions ``V_nm`` and
``W_nm`` (Montenbruck & Gill, *Satellite Orbits*, 2000, section 3.2.4-3.2.5, equations
3.27-3.33). It works on unnormalized coefficients, so the bundled fully normalized ones
are denormalized once when the field is loaded.

The loops are plain Python floats on purpose: for one point at a time that is several times
faster than numpy, and the integrator calls this hundreds of thousands of times.
"""

from functools import cache
from math import factorial, sqrt
from pathlib import Path

from .constants import GM_EARTH, MAX_GRAVITY_DEGREE, R_EARTH

#: Bundled with the package; see ``SOURCES.md`` next to it.
COEFFICIENT_FILE = Path(__file__).parents[2] / "assets" / "gravity" / "egm96_20x20.txt"


@cache
def normalized_coefficients() -> dict[tuple[int, int], tuple[float, float]]:
    """Fully normalized ``(C, S)`` of the bundled EGM96 field, keyed by ``(n, m)``."""
    text = COEFFICIENT_FILE.read_text()
    table: dict[tuple[int, int], tuple[float, float]] = {(0, 0): (1.0, 0.0)}
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        n, m, c, s = line.split()
        table[int(n), int(m)] = (float(c), float(s))
    return table


def _denormalize(n: int, m: int) -> float:
    """Factor turning a fully normalized coefficient into an unnormalized one."""
    delta = 1 if m == 0 else 2
    return sqrt(factorial(n - m) * (2 * n + 1) * delta / factorial(n + m))


class GravityField:
    """EGM96 truncated to a degree and order.

    Degree 0 gives the point mass alone; degree 2, order 0 adds the oblateness (J2).
    """

    def __init__(self, degree: int, order: int | None = None) -> None:
        order = degree if order is None else order
        if not 0 <= order <= degree <= MAX_GRAVITY_DEGREE:
            raise ValueError(f"degree {degree} and order {order} are out of range")
        self.degree = degree
        self.order = order
        table = normalized_coefficients()
        size = degree + 1
        self._c = [[0.0] * size for _ in range(size)]
        self._s = [[0.0] * size for _ in range(size)]
        for n in range(size):
            for m in range(min(n, order) + 1):
                c, s = table.get((n, m), (0.0, 0.0))
                factor = _denormalize(n, m)
                self._c[n][m] = c * factor
                self._s[n][m] = s * factor

    def acceleration(self, x: float, y: float, z: float) -> tuple[float, float, float]:
        """Acceleration in m/s^2 at an Earth-fixed position in metres."""
        degree, order = self.degree, self.order
        r2 = x * x + y * y + z * z
        rho = R_EARTH * R_EARTH / r2
        x0, y0, z0 = R_EARTH * x / r2, R_EARTH * y / r2, R_EARTH * z / r2

        # V[n][m] and W[n][m] up to one degree and order beyond the field.
        size = degree + 2
        v = [[0.0] * size for _ in range(size)]
        w = [[0.0] * size for _ in range(size)]
        v[0][0] = R_EARTH / sqrt(r2)
        v[1][0] = z0 * v[0][0]
        for n in range(2, size):
            v[n][0] = ((2 * n - 1) * z0 * v[n - 1][0] - (n - 1) * rho * v[n - 2][0]) / n
        for m in range(1, min(order + 1, size - 1) + 1):
            v[m][m] = (2 * m - 1) * (x0 * v[m - 1][m - 1] - y0 * w[m - 1][m - 1])
            w[m][m] = (2 * m - 1) * (x0 * w[m - 1][m - 1] + y0 * v[m - 1][m - 1])
            if m + 1 < size:
                v[m + 1][m] = (2 * m + 1) * z0 * v[m][m]
                w[m + 1][m] = (2 * m + 1) * z0 * w[m][m]
            for n in range(m + 2, size):
                a = (2 * n - 1) * z0 / (n - m)
                b = (n + m - 1) * rho / (n - m)
                v[n][m] = a * v[n - 1][m] - b * v[n - 2][m]
                w[n][m] = a * w[n - 1][m] - b * w[n - 2][m]

        ax = ay = az = 0.0
        for n in range(degree + 1):
            c_row, s_row = self._c[n], self._s[n]
            v_up, w_up = v[n + 1], w[n + 1]
            c = c_row[0]
            ax -= c * v_up[1]
            ay -= c * w_up[1]
            az -= (n + 1) * c * v_up[0]
            for m in range(1, min(n, order) + 1):
                c, s = c_row[m], s_row[m]
                ratio = 0.5 * (n - m + 2) * (n - m + 1)
                ax += 0.5 * (-c * v_up[m + 1] - s * w_up[m + 1]) + ratio * (
                    c * v_up[m - 1] + s * w_up[m - 1]
                )
                ay += 0.5 * (-c * w_up[m + 1] + s * v_up[m + 1]) + ratio * (
                    -c * w_up[m - 1] + s * v_up[m - 1]
                )
                az += (n - m + 1) * (-c * v_up[m] - s * w_up[m])
        scale = GM_EARTH / (R_EARTH * R_EARTH)
        return ax * scale, ay * scale, az * scale
