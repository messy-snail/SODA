"""Earth orientation and Sun and Moon positions, tabulated once for an integration arc.

The integrator evaluates the forces hundreds of thousands of times, far too often to ask
Skyfield each time. Instead the GCRS-to-ITRS rotation and the Sun and Moon vectors are
computed on a regular grid up front and interpolated with a 4-point Lagrange polynomial.
On these grids the interpolation error is far below a millimetre of satellite position.

Time here is ``tau``: TT seconds since the state epoch, the integrator's independent
variable.
"""

from math import floor

import numpy as np
from skyfield.framelib import itrs
from skyfield.jpllib import SpiceKernel
from skyfield.timelib import Time

from ..propagator import timescale

ROTATION_STEP_S = 60.0
BODY_STEP_S = 600.0


def tau_of(epoch: Time, t: Time) -> np.ndarray:
    """TT seconds from ``epoch`` to each time of ``t``.

    The whole and fractional days are differenced separately: a plain Julian date only
    resolves about 40 microseconds, which is a third of a metre along a LEO orbit.
    """
    return ((t.whole - epoch.whole) + (t.tt_fraction - epoch.tt_fraction)) * 86400.0


def times_from_tau(epoch: Time, tau: np.ndarray) -> Time:
    """Skyfield times for TT seconds since ``epoch``."""
    return timescale().tt_jd(epoch.whole, epoch.tt_fraction + np.asarray(tau) / 86400.0)


class _Table:
    """Rows on a uniform grid, interpolated with a 4-point Lagrange polynomial."""

    def __init__(self, first: float, step: float, rows: np.ndarray) -> None:
        self._first = first
        self._step = step
        self._rows = [tuple(row) for row in rows.tolist()]

    @staticmethod
    def grid(lower: float, upper: float, step: float) -> np.ndarray:
        """Grid nodes covering ``[lower, upper]`` with the margin interpolation needs."""
        count = int(np.ceil((upper - lower) / step)) + 5
        return lower - 2.0 * step + np.arange(count) * step

    def at(self, tau: float) -> list[float]:
        u = (tau - self._first) / self._step
        index = min(max(floor(u), 1), len(self._rows) - 3)
        s = u - index
        w0 = -s * (s - 1.0) * (s - 2.0) / 6.0
        w1 = (s + 1.0) * (s - 1.0) * (s - 2.0) / 2.0
        w2 = -(s + 1.0) * s * (s - 2.0) / 2.0
        w3 = (s + 1.0) * s * (s - 1.0) / 6.0
        rows = self._rows
        return [
            w0 * a + w1 * b + w2 * c + w3 * d
            for a, b, c, d in zip(
                rows[index - 1], rows[index], rows[index + 1], rows[index + 2], strict=True
            )
        ]


class Environment:
    """What the forces need to know about the Earth, Sun and Moon over one arc."""

    def __init__(
        self, epoch: Time, tau_min: float, tau_max: float, kernel: SpiceKernel | None
    ) -> None:
        """Tabulate the arc ``[tau_min, tau_max]``.

        Args:
            epoch: State epoch, ``tau = 0``.
            tau_min: Earliest ``tau`` the integrator will reach.
            tau_max: Latest ``tau`` the integrator will reach.
            kernel: DE421, for the Sun and Moon; ``None`` leaves them out, which only a
                gravity-only force model can do without.
        """
        grid = _Table.grid(tau_min, tau_max, ROTATION_STEP_S)
        rotation = itrs.rotation_at(times_from_tau(epoch, grid))
        self._rotation = _Table(
            grid[0], ROTATION_STEP_S, np.moveaxis(rotation, -1, 0).reshape(-1, 9)
        )
        self._sun: _Table | None = None
        self._moon: _Table | None = None
        if kernel is not None:
            grid = _Table.grid(tau_min, tau_max, BODY_STEP_S)
            t = times_from_tau(epoch, grid)
            earth = kernel["earth"]
            self._sun = _Table(grid[0], BODY_STEP_S, (kernel["sun"] - earth).at(t).position.m.T)
            self._moon = _Table(grid[0], BODY_STEP_S, (kernel["moon"] - earth).at(t).position.m.T)

    @property
    def has_bodies(self) -> bool:
        return self._sun is not None

    def rotation(self, tau: float) -> list[float]:
        """GCRS-to-ITRS rotation matrix, row-major."""
        return self._rotation.at(tau)

    def sun(self, tau: float) -> list[float]:
        """Geocentric GCRS position of the Sun in metres."""
        assert self._sun is not None
        return self._sun.at(tau)

    def moon(self, tau: float) -> list[float]:
        """Geocentric GCRS position of the Moon in metres."""
        assert self._moon is not None
        return self._moon.at(tau)
