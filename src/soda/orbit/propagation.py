"""Which propagator turns a source into an ``Ephemeris``.

A source is what the satellite is known by: mean elements (OMM), a state vector (OPM), or
an ephemeris somebody else propagated (OEM). Each kind of source can be propagated by some
propagators and not by others, and whichever one runs returns the same ``Ephemeris``, so
swath and the API response do not care which it was.

Mean elements go to SGP4 by default. HPOP can start from them too, from the SGP4 state at
the element epoch; that inherits the error of the element set, so it is a way to study the
force model, not a more accurate orbit.
"""

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal

from skyfield.jpllib import SpiceKernel

from .hpop.propagate import HpopOptions, InitialState, propagate_hpop, state_from_omm
from .oem import StoredEphemeris, interpolate_ephemeris
from .propagator import (
    Ephemeris,
    PropagationRequestError,
    as_utc,
    epoch_warnings,
    propagate,
)

SourceKind = Literal["omm", "opm", "oem"]
Propagator = Literal["sgp4", "hpop", "ephemeris"]

#: Propagators each kind of source accepts; the first is the default.
ALLOWED: dict[SourceKind, tuple[Propagator, ...]] = {
    "omm": ("sgp4", "hpop"),
    "opm": ("hpop",),
    "oem": ("ephemeris",),
}


@dataclass(frozen=True)
class OrbitSource:
    """What a satellite is propagated from."""

    kind: SourceKind
    #: Normalized OMM fields, for ``kind == "omm"``.
    omm: dict[str, Any] | None = None
    #: State to integrate from, for ``kind == "opm"``.
    state: InitialState | None = None
    #: Table to interpolate, for ``kind == "oem"``.
    ephemeris: StoredEphemeris | None = None


@dataclass(frozen=True)
class Propagation:
    """A propagated trajectory and how it was made."""

    ephemeris: Ephemeris
    propagator: Propagator
    #: Forces and spacecraft parameters a numerical propagator used; ``None`` otherwise.
    force_model: dict[str, Any] | None = None


def choose(kind: SourceKind, requested: Propagator | None) -> Propagator:
    """The propagator to use for a source: the requested one, or the source's default.

    Raises:
        PropagationRequestError: ``propagatorNotAllowed`` when the source cannot be
            propagated that way.
    """
    allowed = ALLOWED[kind]
    if requested is None:
        return allowed[0]
    if requested not in allowed:
        raise PropagationRequestError(
            "propagatorNotAllowed",
            f"이 궤도 출처({kind})는 {requested} 전파기로 계산할 수 없음",
            kind=kind,
            propagator=requested,
        )
    return requested


def run(
    source: OrbitSource,
    start: datetime,
    end: datetime,
    step_s: float,
    propagator: Propagator | None = None,
    options: HpopOptions | None = None,
    kernel: SpiceKernel | None = None,
) -> Propagation:
    """Propagate a source over a regular time grid.

    Args:
        source: What to propagate from.
        start: Window start (naive values are UTC).
        end: Window end.
        step_s: Sample spacing in seconds.
        propagator: Which propagator to use; ``None`` picks the source's default.
        options: HPOP force model and spacecraft; ignored by the other propagators.
        kernel: DE421, which HPOP needs unless its force model is gravity only.

    Raises:
        PropagationRequestError: The window is out of range, or the propagator does not
            fit the source.
    """
    chosen = choose(source.kind, propagator)
    if source.kind == "oem":
        assert source.ephemeris is not None
        return Propagation(interpolate_ephemeris(source.ephemeris, start, end, step_s), chosen)
    if source.kind == "omm":
        assert source.omm is not None
        if chosen == "sgp4":
            return Propagation(propagate(source.omm, start, end, step_s), chosen)
        state = state_from_omm(source.omm)
        stale = epoch_warnings(state.epoch.utc_datetime(), as_utc(start), as_utc(end))
    else:
        assert source.state is not None
        state, stale = source.state, []
    ephemeris, force_model = propagate_hpop(
        state, start, end, step_s, options or HpopOptions(), kernel
    )
    return Propagation(replace(ephemeris, warnings=stale + ephemeris.warnings), chosen, force_model)
