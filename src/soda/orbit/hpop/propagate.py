"""HPOP as a propagator: from an initial state and options to an ``Ephemeris``.

The state is integrated from its own epoch, not from the start of the window, so the cost
grows with how far the window lies from the epoch as well as with its length.
"""

import threading
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

import numpy as np
from skyfield.jpllib import SpiceKernel
from skyfield.timelib import Time

from ...errors import message
from ..propagator import (
    Ephemeris,
    PropagationRequestError,
    as_utc,
    ephemeris_from_gcrs,
    sample_offsets,
    satellite_from_omm,
    times_at,
)
from .atmosphere import bulge_exponent
from .constants import (
    ATOL_M,
    BSTAR_TO_CD_AREA_PER_MASS,
    DEFAULT_AREA_M2,
    DEFAULT_CD,
    DEFAULT_CR,
    DEFAULT_GRAVITY_DEGREE,
    DEFAULT_MASS_KG,
    HPOP_MAX_EPOCH_GAP,
    HPOP_MAX_SPAN,
    RTOL,
)
from .environment import Environment, tau_of
from .forces import ForceModel, Spacecraft
from .gravity import GravityField
from .integrate import Trajectory, integrate

SpacecraftSource = Literal["request", "state", "bstar", "default"]
#: From the most to the least trustworthy; a force model reports the weakest it relied on.
_SOURCE_RANK: tuple[SpacecraftSource, ...] = ("request", "state", "bstar", "default")
CACHE_SIZE = 8


@dataclass(frozen=True)
class HpopOptions:
    """Force model switches and spacecraft parameters of one request."""

    gravity_degree: int = DEFAULT_GRAVITY_DEGREE
    #: ``None`` means the same as the degree.
    gravity_order: int | None = None
    third_body: bool = True
    drag: bool = True
    srp: bool = True
    mass_kg: float | None = None
    drag_area_m2: float | None = None
    cd: float | None = None
    srp_area_m2: float | None = None
    cr: float | None = None

    @property
    def needs_bodies(self) -> bool:
        """Whether the Sun and Moon ephemeris (DE421) is required."""
        return self.third_body or self.drag or self.srp


@dataclass(frozen=True)
class InitialState:
    """A GCRS state at an epoch, and what its source knows about the spacecraft."""

    epoch: Time
    position_m: np.ndarray
    velocity_m_s: np.ndarray
    origin: Literal["sgp4AtEpoch", "stateVector"]
    #: Spacecraft fields stored with the state (``mass_kg``, ``cd``, ...), possibly partial.
    spacecraft: dict[str, float] = field(default_factory=dict)
    #: BSTAR of the element set the state came from, in inverse Earth radii.
    bstar: float | None = None


def state_from_omm(omm: dict[str, Any]) -> InitialState:
    """The SGP4 state at the element epoch, as the starting point of an integration.

    This is an osculating state computed from mean elements. It carries the error of the
    element set, so a trajectory integrated from it is not more accurate than SGP4 itself.
    """
    satellite = satellite_from_omm(omm)
    at_epoch = satellite.at(satellite.epoch)
    return InitialState(
        epoch=satellite.epoch,
        position_m=np.asarray(at_epoch.position.m, dtype=float),
        velocity_m_s=np.asarray(at_epoch.velocity.m_per_s, dtype=float),
        origin="sgp4AtEpoch",
        bstar=float(omm["BSTAR"]),
    )


def resolve_spacecraft(
    options: HpopOptions, state: InitialState
) -> tuple[Spacecraft, SpacecraftSource]:
    """Spacecraft parameters, each from the best source that has it.

    The order is the request, then the stored state, then (for the drag area only) the
    BSTAR of the element set, then fixed defaults.

    Returns:
        The parameters, and the weakest source any parameter that matters came from.
    """

    def pick(name: str, default: float) -> tuple[float, SpacecraftSource]:
        requested = getattr(options, name)
        if requested is not None:
            return float(requested), "request"
        if name in state.spacecraft:
            return float(state.spacecraft[name]), "state"
        return default, "default"

    mass, mass_source = pick("mass_kg", DEFAULT_MASS_KG)
    cd, cd_source = pick("cd", DEFAULT_CD)
    cr, cr_source = pick("cr", DEFAULT_CR)
    drag_area, area_source = pick("drag_area_m2", DEFAULT_AREA_M2)
    drag_sources = [mass_source, cd_source, area_source]
    if area_source == "default" and state.bstar and state.bstar > 0:
        # BSTAR fixes Cd * A / m as a whole, so the assumed mass and Cd cancel out of drag.
        drag_area = BSTAR_TO_CD_AREA_PER_MASS * state.bstar * mass / cd
        drag_sources = ["bstar"]
    srp_area, srp_area_source = pick("srp_area_m2", drag_area)
    if srp_area_source == "default" and area_source != "default":
        srp_area_source = area_source
    used = (drag_sources if options.drag else []) + (
        [mass_source, cr_source, srp_area_source] if options.srp else []
    )
    weakest = max(used, key=_SOURCE_RANK.index, default="request")
    return Spacecraft(mass, drag_area, cd, srp_area, cr), weakest


def check_window(epoch: datetime, start: datetime, end: datetime) -> None:
    """Reject windows the integrator would take too long over.

    Raises:
        PropagationRequestError: ``hpopSpanTooLong`` or ``hpopEpochTooFar``.
    """
    if end - start > HPOP_MAX_SPAN:
        raise PropagationRequestError(
            "hpopSpanTooLong",
            f"HPOP 전파 기간은 최대 {HPOP_MAX_SPAN.days}일",
            days=HPOP_MAX_SPAN.days,
        )
    gap = max(start - epoch, epoch - end, timedelta(0))
    if gap > HPOP_MAX_EPOCH_GAP:
        raise PropagationRequestError(
            "hpopEpochTooFar",
            f"HPOP 전파 구간은 epoch에서 {HPOP_MAX_EPOCH_GAP.days}일 이내여야 함",
            days=HPOP_MAX_EPOCH_GAP.days,
        )


def _inclination_rad(position_m: np.ndarray, velocity_m_s: np.ndarray) -> float:
    momentum = np.cross(position_m, velocity_m_s)
    return float(np.arccos(np.clip(momentum[2] / np.linalg.norm(momentum), -1.0, 1.0)))


_cache: OrderedDict[tuple, Trajectory] = OrderedDict()
_lock = threading.Lock()


def _trajectory(
    state: InitialState,
    options: HpopOptions,
    craft: Spacecraft,
    kernel: SpiceKernel | None,
    tau_min: float,
    tau_max: float,
) -> Trajectory:
    """Integrate, or reuse the last integration of the same state and force model.

    ``/swath`` propagates again for every sensor change; without this each of those would
    repeat seconds of integration. One lock for all keys is enough: the right-hand side is
    pure Python and holds the GIL, so two integrations would not run in parallel anyway.
    """
    order = options.gravity_degree if options.gravity_order is None else options.gravity_order
    exponent = bulge_exponent(_inclination_rad(state.position_m, state.velocity_m_s))
    key = (
        state.position_m.tobytes(),
        state.velocity_m_s.tobytes(),
        float(state.epoch.whole),
        float(state.epoch.tt_fraction),
        options.gravity_degree,
        order,
        options.third_body,
        options.drag,
        options.srp,
        craft if options.drag or options.srp else None,
    )
    with _lock:
        cached = _cache.get(key)
        if cached is not None and cached.covers(tau_min, tau_max):
            _cache.move_to_end(key)
            return cached
        lower, upper = min(tau_min, 0.0), max(tau_max, 0.0)
        if cached is not None:
            lower, upper = min(lower, cached.requested[0]), max(upper, cached.requested[1])
        environment = Environment(
            state.epoch, lower, upper, kernel if options.needs_bodies else None
        )
        force = ForceModel(
            GravityField(options.gravity_degree, order),
            environment,
            craft,
            third_body=options.third_body,
            drag=options.drag,
            srp=options.srp,
            bulge_exponent=exponent,
        )
        trajectory = integrate(force, state.position_m, state.velocity_m_s, lower, upper)
        _cache[key] = trajectory
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
        return trajectory


def propagate_hpop(
    state: InitialState,
    start: datetime,
    end: datetime,
    step_s: float,
    options: HpopOptions,
    kernel: SpiceKernel | None,
) -> tuple[Ephemeris, dict[str, Any]]:
    """Integrate a state over a regular time grid.

    Args:
        state: Where to start from.
        start: Window start (naive values are UTC).
        end: Window end.
        step_s: Sample spacing in seconds.
        options: Force model switches and spacecraft parameters.
        kernel: DE421; required unless the force model is gravity only.

    Returns:
        The samples, and a description of the force model that produced them.

    Raises:
        PropagationRequestError: Window, step, or sample count out of range.
    """
    start, end = as_utc(start), as_utc(end)
    offsets = sample_offsets(start, end, step_s)
    check_window(state.epoch.utc_datetime(), start, end)
    craft, source = resolve_spacecraft(options, state)
    t = times_at(start, offsets)
    tau = tau_of(state.epoch, t)
    trajectory = _trajectory(state, options, craft, kernel, float(tau[0]), float(tau[-1]))
    position_m, velocity_m_s, valid = trajectory.sample(tau)

    warnings: list[dict[str, Any]] = []
    if (options.drag or options.srp) and source in ("bstar", "default"):
        warnings.append(
            message(
                "hpopAssumedSpacecraft",
                "위성 질량·면적을 몰라 추정값으로 항력·복사압 계산",
                source=source,
            )
        )
    if not valid.all():
        failed = int((~valid).sum())
        warnings.append(
            message(
                "hpopFailures",
                f"HPOP가 {failed}개 샘플 계산 실패 (재진입 가능)",
                count=failed,
            )
        )
    ephemeris = ephemeris_from_gcrs(start, step_s, t, position_m, velocity_m_s, valid, warnings)
    force_model = {
        "gravity_degree": options.gravity_degree,
        "gravity_order": options.gravity_degree
        if options.gravity_order is None
        else options.gravity_order,
        "third_body": options.third_body,
        "drag": options.drag,
        "srp": options.srp,
        **asdict(craft),
        "spacecraft_source": source,
        "initial_state": state.origin,
        "integrator": "DOP853",
        "rtol": RTOL,
        "atol_m": ATOL_M,
    }
    return ephemeris, force_model
