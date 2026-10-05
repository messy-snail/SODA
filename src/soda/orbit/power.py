"""Battery state of charge over a propagated orbit: a first-order energy balance.

The satellite keeps its solar array on the Sun unless it is imaging or, when the contact
attitude says so, talking to a ground station. The array then follows the body, and its
output drops with the cosine of the Sun's incidence::

    P_gen = array_w * (1 AU / r)^2 * max(cos(incidence), 0)     (zero in eclipse)
    surplus:  E += (P_gen - P_load) * charge_efficiency * dt    (clamped at the capacity)
    deficit:  E -= (P_load - P_gen) / discharge_efficiency * dt (clamped at zero)

This is the structure of Basilisk's ``simpleSolarPanel``, ``simplePowerSink`` and
``simpleBattery`` modules (https://github.com/AVSLab/basilisk, ISC), with path efficiencies
added. Only the equations are shared; no code is taken from it.

Not modelled: penumbra, self-shadowing of the array, temperature, battery voltage and
ageing. An imaging roll and pitch are held for the whole acquisition.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import numpy as np
from skyfield.jpllib import SpiceKernel

from ..errors import CodedError
from .battery import Battery, run_circuit
from .eclipse import eclipse_intervals_s
from .power_geometry import (
    incidence_cos,
    nadir_boresight,
    shot_boresight,
    states_at,
    station_boresight,
)
from .propagator import Ephemeris, times_at
from .sun import beta_series_deg, sun_distance_au, sun_unit_itrs

#: Imaging acquisitions plus contacts one request may carry.
MAX_POWER_INTERVALS = 5000
#: Spacing of the incidence samples while the array is off the Sun.
ACTIVITY_STEP_S = 5.0
#: Incidence samples of one simulation; the spacing grows to stay under it.
MAX_ACTIVITY_STEPS = 50_000
#: Ephemeris spacing above which the attitude between samples is only approximate.
COARSE_STEP_S = 120.0
#: Spacing of the Sun distance table, which changes by a few percent over a year.
DISTANCE_STEP_S = 3600.0

ContactAttitude = Literal["sun", "nadir", "station"]

_SUN, _NADIR, _STATION, _SHOT = 0, 1, 2, 3


class PowerRequestError(CodedError, ValueError):
    """The requested activities are outside the supported limits."""


@dataclass(frozen=True)
class PowerSpec:
    """Array, battery and loads of the satellite.

    Attributes:
        array_w: Array output facing the Sun at 1 AU, after every loss up to the bus.
        capacity_wh: Usable battery capacity.
        initial_soc: State of charge at the start, 0 to 1.
        charge_efficiency: Fraction of surplus bus power that ends up stored.
        discharge_efficiency: Fraction of stored energy that reaches the bus.
        dod_limit: Depth of discharge the battery should stay within, 0 to 1.
        base_w: Load that is always on.
        imaging_w: Load added during an acquisition.
        downlink_w: Load added during a contact that downlinks payload data.
        contact_w: Load added during any other contact.
        contact_attitude: ``sun`` keeps the array on the Sun during a contact (a steered
            or omnidirectional antenna), ``nadir`` points the body at the Earth, and
            ``station`` turns it to follow the ground station.
        slew_s: Time before and after an activity spent in the activity's attitude.
        battery: Equivalent circuit of the battery. ``None`` keeps the energy balance
            above, with ``capacity_wh`` and the two efficiencies as the whole model.
    """

    array_w: float
    capacity_wh: float
    initial_soc: float = 1.0
    charge_efficiency: float = 0.9
    discharge_efficiency: float = 0.9
    dod_limit: float = 0.3
    base_w: float = 0.0
    imaging_w: float = 0.0
    downlink_w: float = 0.0
    contact_w: float = 0.0
    contact_attitude: ContactAttitude = "sun"
    slew_s: float = 0.0
    battery: Battery | None = None


@dataclass(frozen=True)
class Shot:
    """One imaging acquisition, in seconds from the first ephemeris sample."""

    start_s: float
    end_s: float
    roll_deg: float
    pitch_deg: float


@dataclass(frozen=True)
class Contact:
    """One ground contact, in seconds from the first ephemeris sample."""

    start_s: float
    end_s: float
    downlink: bool = True
    #: Earth-fixed station position; only the ``station`` attitude reads it.
    station_m: np.ndarray | None = None


@dataclass(frozen=True)
class Sun:
    """The Sun at ``offsets_s`` seconds from the first ephemeris sample."""

    #: Earth-fixed unit vectors toward the Sun, ``(N,) -> (N, 3)``.
    unit_itrs: Callable[[np.ndarray], np.ndarray]
    #: Distance to the Sun in astronomical units, ``(N,) -> (N,)``.
    distance_au: Callable[[np.ndarray], np.ndarray]


@dataclass(frozen=True)
class Timeline:
    """Generation and load, each constant between consecutive edges."""

    edges_s: np.ndarray
    generation_w: np.ndarray
    load_w: np.ndarray
    #: Flat ``[enter0, exit0, ...]`` eclipse intervals the generation was cut by.
    eclipse_s: list[float]
    #: Time the array spent off the Sun in sunlight.
    off_sun_s: float


@dataclass(frozen=True)
class PowerResult:
    """State of charge over time and where the energy went.

    Attributes:
        time_s: Seconds from the first ephemeris sample.
        soc: State of charge at ``time_s``, 0 to 1; linear in between.
        capacity_wh: Energy of the full battery; the area under the open-circuit voltage
            curve when there is one.
        generated_wh: Array output over the span.
        consumed_wh: Load that was served.
        shunted_wh: Array output with nowhere to go once the battery was full.
        unmet_wh: Load that was not served because the battery was empty.
        min_soc: Lowest state of charge, 0 to 1.
        final_soc: State of charge at the end.
        below_limit_s: Flat ``[start0, end0, ...]`` spans beyond the depth of discharge limit.
        empty_s: Flat ``[start0, end0, ...]`` spans with an empty battery and unserved load.
        eclipse_s: Flat ``[enter0, exit0, ...]`` eclipse intervals.
        off_sun_s: Time the array spent off the Sun in sunlight.
        voltage_v: Terminal voltage at ``time_s``; equivalent circuit only, like the rest.
        current_a: Battery current at ``time_s``, positive discharging.
        loss_wh: Heat in the internal resistance.
        min_voltage_v: Lowest terminal voltage.
        max_voltage_v: Highest terminal voltage.
        max_discharge_a: Largest discharging current.
        max_charge_a: Largest charging current.
    """

    time_s: np.ndarray
    soc: np.ndarray
    capacity_wh: float
    generated_wh: float
    consumed_wh: float
    shunted_wh: float
    unmet_wh: float
    min_soc: float
    final_soc: float
    below_limit_s: list[float]
    empty_s: list[float]
    eclipse_s: list[float]
    off_sun_s: float
    voltage_v: np.ndarray | None = None
    current_a: np.ndarray | None = None
    loss_wh: float | None = None
    min_voltage_v: float | None = None
    max_voltage_v: float | None = None
    max_discharge_a: float | None = None
    max_charge_a: float | None = None


def kernel_sun(kernel: SpiceKernel, start: datetime) -> Sun:
    """The DE421 Sun for an ephemeris that starts at ``start``."""
    return Sun(
        unit_itrs=lambda offsets: sun_unit_itrs(kernel, times_at(start, offsets)),
        distance_au=lambda offsets: sun_distance_au(kernel, times_at(start, offsets)),
    )


def span_s(ephemeris: Ephemeris) -> float:
    """Length of an ephemeris in seconds."""
    return max(len(ephemeris) - 1, 0) * ephemeris.step_s


def beta_deg(ephemeris: Ephemeris, kernel: SpiceKernel) -> tuple[float, float] | None:
    """Sun angle off the orbit plane at the first and last valid pair of samples.

    Returns:
        Degrees, positive on the side of the orbit's angular momentum, or ``None`` when no
        two consecutive samples are valid.
    """
    series = beta_series_deg(ephemeris, kernel, max_points=2)
    if series is None:
        return None
    return float(series[1][0]), float(series[1][-1])


def _segments(edges: np.ndarray, start_s: float, end_s: float) -> slice:
    """Segments of ``edges`` between two values that are themselves edges."""
    return slice(int(np.searchsorted(edges, start_s)), int(np.searchsorted(edges, end_s)))


def build_timeline(
    ephemeris: Ephemeris,
    sun: Sun,
    spec: PowerSpec,
    shots: Sequence[Shot],
    contacts: Sequence[Contact],
    begin_s: float = 0.0,
) -> Timeline:
    """Generation and load from ``begin_s`` to the end of the ephemeris.

    The rates are piecewise constant. Where activities overlap the attitude is the
    acquisition's, then the contact's, then Sun-pointing; the acquisition load adds to the
    largest contact load.
    """
    span = span_s(ephemeris)
    offsets = np.arange(len(ephemeris)) * ephemeris.step_s
    eclipse = eclipse_intervals_s(
        ephemeris.fixed_m, sun.unit_itrs(offsets), ephemeris.valid, ephemeris.step_s
    )

    def clip(start_s: float, end_s: float, margin_s: float = 0.0) -> tuple[float, float]:
        low = min(max(start_s - margin_s, begin_s), span)
        return low, min(max(end_s + margin_s, low), span)

    turned = spec.contact_attitude != "sun"
    shot_loads = [clip(shot.start_s, shot.end_s) for shot in shots]
    shot_turns = [clip(shot.start_s, shot.end_s, spec.slew_s) for shot in shots]
    contact_loads = [clip(contact.start_s, contact.end_s) for contact in contacts]
    contact_turns = [
        clip(contact.start_s, contact.end_s, spec.slew_s) if turned else None
        for contact in contacts
    ]
    turns = shot_turns + [turn for turn in contact_turns if turn is not None]

    total = sum(end - start for start, end in turns)
    step = max(ACTIVITY_STEP_S, total / MAX_ACTIVITY_STEPS)
    marks = [np.array([begin_s, span]), np.asarray(eclipse, dtype=float)]
    marks += [np.asarray(pair) for pair in shot_loads + contact_loads]
    marks += [np.append(np.arange(start, end, step), end) for start, end in turns]
    edges = np.unique(np.concatenate(marks))
    edges = edges[edges >= begin_s]
    mid = (edges[:-1] + edges[1:]) / 2
    count = len(mid)

    attitude = np.full(count, _SUN, dtype=np.int8)
    roll, pitch = np.zeros(count), np.zeros(count)
    station = np.zeros((count, 3))
    contact_load = np.zeros(count)
    imaging = np.zeros(count, dtype=bool)
    for contact, load, turn in zip(contacts, contact_loads, contact_turns, strict=True):
        rows = _segments(edges, *load)
        watts = spec.downlink_w if contact.downlink else spec.contact_w
        contact_load[rows] = np.maximum(contact_load[rows], watts)
        if turn is None:
            continue
        rows = _segments(edges, *turn)
        if spec.contact_attitude == "station" and contact.station_m is not None:
            attitude[rows], station[rows] = _STATION, contact.station_m
        else:
            attitude[rows] = _NADIR
    for shot, load, turn in zip(shots, shot_loads, shot_turns, strict=True):
        imaging[_segments(edges, *load)] = True
        rows = _segments(edges, *turn)
        attitude[rows], roll[rows], pitch[rows] = _SHOT, shot.roll_deg, shot.pitch_deg

    sunlit = np.searchsorted(eclipse, mid, side="right") % 2 == 0
    cos = np.ones(count)
    off = sunlit & (attitude != _SUN)
    if off.any() and ephemeris.valid.sum() >= 2:
        position, velocity = states_at(ephemeris, mid[off])
        kind = attitude[off]
        boresight = nadir_boresight(position)
        tilted = kind == _SHOT
        if tilted.any():
            boresight[tilted] = shot_boresight(
                position[tilted], velocity[tilted], roll[off][tilted], pitch[off][tilted]
            )
        tracking = kind == _STATION
        if tracking.any():
            boresight[tracking] = station_boresight(position[tracking], station[off][tracking])
        cos[off] = incidence_cos(boresight, sun.unit_itrs(mid[off]))

    table = np.linspace(0.0, span, max(int(np.ceil(span / DISTANCE_STEP_S)) + 1, 2))
    distance = np.interp(mid, table, sun.distance_au(table))
    generation = spec.array_w / distance**2 * cos * sunlit
    load_w = spec.base_w + contact_load + np.where(imaging, spec.imaging_w, 0.0)
    off_sun_s = float(np.diff(edges)[off].sum())
    return Timeline(edges, generation, load_w, eclipse, off_sun_s)


def _spans_below(time_s: np.ndarray, level: np.ndarray, threshold: float) -> list[float]:
    """Flat spans in which a piecewise-linear ``level`` is under ``threshold``."""
    below = level < threshold
    spans: list[float] = [float(time_s[0])] if below[0] else []
    for i in np.where(below[:-1] != below[1:])[0]:
        fraction = (threshold - level[i]) / (level[i + 1] - level[i])
        spans.append(float(time_s[i] + fraction * (time_s[i + 1] - time_s[i])))
    if below[-1]:
        spans.append(float(time_s[-1]))
    return spans


def integrate(timeline: Timeline, spec: PowerSpec) -> PowerResult:
    """Run the battery through a timeline.

    The rates are constant inside a segment, so the stored energy is linear there and the
    moment it reaches empty or full is solved for, not stepped over.
    """
    capacity = spec.capacity_wh
    energy = min(max(spec.initial_soc, 0.0), 1.0) * capacity
    edges = timeline.edges_s
    times, levels = [float(edges[0])], [energy]
    generated = consumed = shunted = unmet = 0.0
    empty: list[float] = []
    rates = zip(timeline.generation_w.tolist(), timeline.load_w.tolist(), strict=True)
    for k, (generation, load) in enumerate(rates):
        start, end = float(edges[k]), float(edges[k + 1])
        hours = (end - start) / 3600.0
        net = generation - load
        rate = net * spec.charge_efficiency if net >= 0 else net / spec.discharge_efficiency
        target = energy + rate * hours
        generated += generation * hours
        consumed += load * hours
        if target > capacity:
            if energy < capacity:
                times.append(start + (capacity - energy) / rate * 3600.0)
                levels.append(capacity)
            shunted += (target - capacity) / spec.charge_efficiency
            target = capacity
        elif target < 0:
            reached = start + energy / -rate * 3600.0
            if energy > 0:
                times.append(reached)
                levels.append(0.0)
            lost = -target * spec.discharge_efficiency
            unmet += lost
            consumed -= lost
            if empty and empty[-1] >= reached:
                empty[-1] = end
            else:
                empty += [reached, end]
            target = 0.0
        energy = target
        times.append(end)
        levels.append(energy)

    time_s, level = np.array(times), np.array(levels)
    # Drop the points a straight line already passes through.
    duration = np.diff(time_s)
    slope = np.diff(level) / np.where(duration > 0, duration, 1.0)
    keep = np.ones(len(time_s), dtype=bool)
    keep[1:-1] = (np.abs(np.diff(slope)) > 1e-9) & (duration[:-1] > 0)
    time_s, level = time_s[keep], level[keep]
    return PowerResult(
        time_s=time_s,
        soc=level / capacity,
        capacity_wh=capacity,
        generated_wh=generated,
        consumed_wh=consumed,
        shunted_wh=shunted,
        unmet_wh=unmet,
        min_soc=float(level.min() / capacity),
        final_soc=float(level[-1] / capacity),
        below_limit_s=_spans_below(time_s, level, capacity * (1.0 - spec.dod_limit)),
        empty_s=empty,
        eclipse_s=timeline.eclipse_s,
        off_sun_s=timeline.off_sun_s,
    )


def integrate_circuit(timeline: Timeline, spec: PowerSpec) -> PowerResult:
    """Run the equivalent circuit of ``spec.battery`` through a timeline."""
    battery = spec.battery
    assert battery is not None
    trace = run_circuit(
        battery,
        timeline.edges_s,
        timeline.generation_w,
        timeline.load_w,
        spec.initial_soc,
        spec.charge_efficiency,
        spec.discharge_efficiency,
    )
    hours = np.diff(timeline.edges_s) / 3600.0
    return PowerResult(
        time_s=trace.time_s,
        soc=trace.soc,
        capacity_wh=battery.nominal_wh,
        generated_wh=float((timeline.generation_w * hours).sum()),
        consumed_wh=float((timeline.load_w * hours).sum()) - trace.unmet_wh,
        shunted_wh=trace.shunted_wh,
        unmet_wh=trace.unmet_wh,
        min_soc=trace.min_soc,
        final_soc=float(trace.full_soc[-1]),
        below_limit_s=_spans_below(trace.full_time_s, trace.full_soc, 1.0 - spec.dod_limit),
        empty_s=trace.unmet_s,
        eclipse_s=timeline.eclipse_s,
        off_sun_s=timeline.off_sun_s,
        voltage_v=trace.voltage_v,
        current_a=trace.current_a,
        loss_wh=trace.loss_wh,
        min_voltage_v=trace.min_voltage_v,
        max_voltage_v=trace.max_voltage_v,
        max_discharge_a=trace.max_discharge_a,
        max_charge_a=trace.max_charge_a,
    )


def simulate_power(
    ephemeris: Ephemeris,
    sun: Sun,
    spec: PowerSpec,
    shots: Sequence[Shot],
    contacts: Sequence[Contact],
    begin_s: float = 0.0,
) -> PowerResult:
    """State of charge of the battery over an ephemeris.

    Args:
        ephemeris: The propagated orbit.
        sun: Where the Sun is; ``kernel_sun`` gives the DE421 one.
        spec: Array, battery and loads.
        shots: Imaging acquisitions, with the roll and pitch each one is taken at.
        contacts: Ground contacts.
        begin_s: Seconds from the first sample at which the battery holds
            ``spec.initial_soc``. The result runs from there to the end of the ephemeris.

    Raises:
        PowerRequestError: ``powerIntervalsTooMany`` when there are more acquisitions and
            contacts than ``MAX_POWER_INTERVALS``; ``powerStartOutsideRun`` when
            ``begin_s`` is not inside the ephemeris.
    """
    if begin_s != 0 and not 0 <= begin_s < span_s(ephemeris):
        raise PowerRequestError(
            "powerStartOutsideRun", "시작 SOC의 기준 시각이 전파 구간 밖", span_s=span_s(ephemeris)
        )
    count = len(shots) + len(contacts)
    if count > MAX_POWER_INTERVALS:
        raise PowerRequestError(
            "powerIntervalsTooMany",
            f"촬영·교신 구간은 최대 {MAX_POWER_INTERVALS}개",
            max=MAX_POWER_INTERVALS,
            count=count,
        )
    timeline = build_timeline(ephemeris, sun, spec, shots, contacts, begin_s)
    return integrate(timeline, spec) if spec.battery is None else integrate_circuit(timeline, spec)
