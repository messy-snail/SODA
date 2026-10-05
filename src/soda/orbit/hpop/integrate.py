"""Cowell integration of a state from its epoch, forwards and backwards in time."""

from collections.abc import Callable
from dataclasses import dataclass
from math import sqrt

import numpy as np
from scipy.integrate import OdeSolution, solve_ivp

from .constants import ATOL_M, ATOL_M_S, MAX_STEP_S, R_EARTH, REENTRY_ALT_M, RTOL

Force = Callable[[float, np.ndarray], list[float]]


def _reentry(_tau: float, state: np.ndarray) -> float:
    x, y, z = float(state[0]), float(state[1]), float(state[2])
    return sqrt(x * x + y * y + z * z) - (R_EARTH + REENTRY_ALT_M)


_reentry.terminal = True  # type: ignore[attr-defined]
_reentry.direction = -1  # type: ignore[attr-defined]


@dataclass(frozen=True)
class Trajectory:
    """A continuous solution around the state epoch, ``tau = 0``."""

    #: Dense solutions from the epoch towards later and earlier times, when integrated.
    forward: OdeSolution | None
    backward: OdeSolution | None
    #: Range of ``tau`` the solution covers. Short of what was asked when the satellite
    #: re-entered or the integrator gave up.
    tau_min: float
    tau_max: float
    #: Range that was asked for.
    requested: tuple[float, float]

    def covers(self, tau_min: float, tau_max: float) -> bool:
        """Whether another request for this range would get the same answer."""
        return self.requested[0] <= tau_min and tau_max <= self.requested[1]

    def sample(self, tau: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Positions and velocities at ``tau``, and which of them the solution reaches.

        Returns:
            ``(N, 3)`` positions in metres, ``(N, 3)`` velocities in m/s, and an ``(N,)``
            mask; rows outside the mask are NaN.
        """
        tau = np.asarray(tau, dtype=float)
        states = np.full((len(tau), 6), np.nan)
        valid = (tau >= self.tau_min) & (tau <= self.tau_max)
        # The epoch itself belongs to whichever arc exists.
        later = tau >= 0.0 if self.backward is not None else np.ones(len(tau), dtype=bool)
        if self.forward is None:
            later = np.zeros(len(tau), dtype=bool)
        for solution, side in ((self.forward, later), (self.backward, ~later)):
            chosen = valid & side
            if solution is not None and chosen.any():
                states[chosen] = solution(tau[chosen]).T
        valid &= np.isfinite(states).all(axis=1)
        return states[:, :3], states[:, 3:], valid


def _arc(force: Force, state: np.ndarray, tau_end: float) -> tuple[OdeSolution, float]:
    result = solve_ivp(
        force,
        (0.0, tau_end),
        state,
        method="DOP853",
        rtol=RTOL,
        atol=[ATOL_M] * 3 + [ATOL_M_S] * 3,
        max_step=MAX_STEP_S,
        dense_output=True,
        events=_reentry,
    )
    return result.sol, float(result.t[-1])


def integrate(
    force: Force,
    position_m: np.ndarray,
    velocity_m_s: np.ndarray,
    tau_min: float,
    tau_max: float,
) -> Trajectory:
    """Integrate from the epoch state so that ``[tau_min, tau_max]`` is covered.

    Args:
        force: Right-hand side ``f(tau, state)``.
        position_m: GCRS position at ``tau = 0``.
        velocity_m_s: GCRS velocity at ``tau = 0``.
        tau_min: Earliest time needed, in TT seconds from the epoch (may be positive).
        tau_max: Latest time needed (may be negative).
    """
    state = np.concatenate([position_m, velocity_m_s]).astype(float)
    forward = backward = None
    reached_min = reached_max = 0.0
    if tau_max > 0.0:
        forward, reached_max = _arc(force, state, tau_max)
    if tau_min < 0.0:
        backward, reached_min = _arc(force, state, tau_min)
    requested = (min(tau_min, 0.0), max(tau_max, 0.0))
    return Trajectory(forward, backward, reached_min, reached_max, requested)
