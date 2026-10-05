"""A battery as an equivalent circuit: an open-circuit voltage behind one resistance.

The open-circuit voltage follows the state of charge along a curve, and the terminal
voltage is what is left after the drop across the internal resistance::

    V = OCV(SOC) - I * R                  I > 0 discharges
    discharge:  P = V * I    ->  I = (OCV - sqrt(OCV^2 - 4 R P)) / 2R,  V >= V_min
    charge:     P = V * |I|  ->  |I| = (-OCV + sqrt(OCV^2 + 4 R P)) / 2R
                |I| <= I_max and V <= V_max, so |I| <= (V_max - OCV) / R
    dSOC/dt = -I / capacity

The voltage limit on charging is what tapers the current as the battery fills (the
constant-voltage phase), and the loss is the ``I^2 R`` heat. Temperature, ageing and the
slower dynamics a battery also has are not modelled.
"""

import math
from bisect import bisect_right
from dataclasses import dataclass

import numpy as np

from ..errors import CodedError

#: Points one open-circuit voltage curve may have.
MAX_OCV_POINTS = 32
#: Longest step of the integration; the state of charge moves little in this time.
CIRCUIT_STEP_S = 10.0
#: Steps of one simulation; the step grows to stay under it.
MAX_CIRCUIT_STEPS = 300_000
#: Samples kept per simulation for the response (two per time bucket).
TRACE_BUCKETS = 3000

#: The shape of a lithium-ion cell's open-circuit voltage, as a starting point. It is an
#: illustration, not a datasheet: enter the curve of the real cell to get its numbers.
DEFAULT_OCV_SOC = (0.0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
DEFAULT_OCV_CELL_V = (3.0, 3.3, 3.45, 3.55, 3.62, 3.68, 3.74, 3.82, 3.91, 4.0, 4.09, 4.2)


class BatteryCurveError(CodedError, ValueError):
    """The open-circuit voltage curve or the voltage limits cannot be used."""


@dataclass(frozen=True)
class Battery:
    """A pack of cells in series.

    Attributes:
        cells_series: Cells in series; the curve and the cell limits scale by it.
        capacity_ah: Charge between 0 and 100 % state of charge.
        resistance_ohm: Internal resistance of the whole pack.
        max_charge_a: Largest charging current (the constant-current phase).
        cell_max_v: Cell voltage charging stops rising at (the constant-voltage phase).
        cell_min_v: Cell voltage below which the pack stops discharging.
        ocv_soc: State of charge of the curve points, ascending from 0 to 1.
        ocv_cell_v: Open-circuit cell voltage at ``ocv_soc``, never falling.
    """

    cells_series: int
    capacity_ah: float
    resistance_ohm: float
    max_charge_a: float
    cell_max_v: float
    cell_min_v: float
    ocv_soc: tuple[float, ...] = DEFAULT_OCV_SOC
    ocv_cell_v: tuple[float, ...] = DEFAULT_OCV_CELL_V

    def __post_init__(self) -> None:
        soc, volts = self.ocv_soc, self.ocv_cell_v
        count = len(soc)
        usable = (
            2 <= count <= MAX_OCV_POINTS
            and count == len(volts)
            and soc[0] == 0.0
            and soc[-1] == 1.0
            and all(a < b for a, b in zip(soc, soc[1:], strict=False))
            and all(a <= b for a, b in zip(volts, volts[1:], strict=False))
            and volts[0] > 0
        )
        if not usable:
            raise BatteryCurveError(
                "batteryCurveInvalid",
                "개방전압 곡선은 SOC 0~100%를 오름차순으로, 전압은 내려가지 않게 2~"
                f"{MAX_OCV_POINTS}점",
                max=MAX_OCV_POINTS,
            )
        if not self.cell_min_v < self.cell_max_v:
            raise BatteryCurveError(
                "batteryCurveInvalid", "셀 차단 전압은 최대 전압보다 낮아야 함", max=MAX_OCV_POINTS
            )

    @property
    def max_voltage_v(self) -> float:
        return self.cells_series * self.cell_max_v

    @property
    def min_voltage_v(self) -> float:
        return self.cells_series * self.cell_min_v

    @property
    def nominal_wh(self) -> float:
        """Energy between empty and full at open circuit: the area under the curve."""
        soc, volts = np.asarray(self.ocv_soc), np.asarray(self.ocv_cell_v)
        mean = ((volts[1:] + volts[:-1]) / 2 * np.diff(soc)).sum()
        return float(self.cells_series * mean * self.capacity_ah)

    def ocv(self, soc: float) -> float:
        """Open-circuit voltage of the pack at a state of charge between 0 and 1."""
        points, volts = self.ocv_soc, self.ocv_cell_v
        upper = min(max(bisect_right(points, soc), 1), len(points) - 1)
        low, high = points[upper - 1], points[upper]
        fraction = min(max((soc - low) / (high - low), 0.0), 1.0)
        return self.cells_series * (volts[upper - 1] + fraction * (volts[upper] - volts[upper - 1]))

    def flow(
        self, soc: float, bus_w: float, charge_efficiency: float, discharge_efficiency: float
    ) -> tuple[float, float, float, float]:
        """What the pack does with the power the bus has left over or is short of.

        Args:
            soc: State of charge, 0 to 1.
            bus_w: Generation minus load; positive is a surplus to store.
            charge_efficiency: Fraction of a surplus that reaches the terminals.
            discharge_efficiency: Fraction of the terminal power that reaches the bus.

        Returns:
            ``(current_a, voltage_v, unmet_w, shunted_w)``: the current (positive
            discharging), the terminal voltage, the load left unserved and the surplus
            left unused, both at the bus.
        """
        ocv, resistance = self.ocv(soc), self.resistance_ohm
        if bus_w >= 0:
            power = bus_w * charge_efficiency
            if resistance > 0:
                wanted = (-ocv + math.sqrt(ocv * ocv + 4 * resistance * power)) / (2 * resistance)
                room = max((self.max_voltage_v - ocv) / resistance, 0.0)
            else:
                wanted = power / ocv
                room = math.inf if ocv < self.max_voltage_v else 0.0
            current = 0.0 if soc >= 1.0 else min(wanted, room, self.max_charge_a)
            voltage = ocv + current * resistance
            # Only a current held back by a limit leaves surplus behind.
            shunted = (power - voltage * current) / charge_efficiency if current < wanted else 0.0
            return -current, voltage, 0.0, shunted

        power = -bus_w / discharge_efficiency
        if resistance > 0:
            reach = ocv * ocv - 4 * resistance * power
            # Past the peak of the power curve the pack cannot give more, whatever it draws.
            root = math.sqrt(reach) if reach > 0 else 0.0
            wanted = (ocv - root) / (2 * resistance)
            room = max((ocv - self.min_voltage_v) / resistance, 0.0)
        else:
            wanted = power / ocv
            room = math.inf if ocv > self.min_voltage_v else 0.0
        current = 0.0 if soc <= 0.0 else min(wanted, room)
        voltage = ocv - current * resistance
        unmet = (power - voltage * current) * discharge_efficiency if current < wanted else 0.0
        return current, voltage, unmet, 0.0


@dataclass(frozen=True)
class CircuitTrace:
    """A battery run through a schedule of generation and load.

    ``time_s``, ``soc``, ``voltage_v`` and ``current_a`` are thinned for drawing; where the
    schedule changes they hold two samples at one time, the value before and after.
    """

    time_s: np.ndarray
    soc: np.ndarray
    voltage_v: np.ndarray
    current_a: np.ndarray
    shunted_wh: float
    unmet_wh: float
    loss_wh: float
    min_soc: float
    min_voltage_v: float
    max_voltage_v: float
    max_discharge_a: float
    max_charge_a: float
    #: Flat ``[start0, end0, ...]`` spans in which some load went unserved.
    unmet_s: list[float]
    #: Every step, for the spans the caller measures on the state of charge.
    full_time_s: np.ndarray
    full_soc: np.ndarray


def run_circuit(
    battery: Battery,
    edges_s: np.ndarray,
    generation_w: np.ndarray,
    load_w: np.ndarray,
    initial_soc: float,
    charge_efficiency: float,
    discharge_efficiency: float,
) -> CircuitTrace:
    """Integrate the state of charge over piecewise-constant generation and load.

    Each segment is cut into steps of at most ``CIRCUIT_STEP_S`` and advanced with the
    midpoint rule, since the current depends on the state of charge it changes.

    Args:
        battery: The pack.
        edges_s: ``(M + 1,)`` segment boundaries in seconds.
        generation_w: ``(M,)`` array output in each segment.
        load_w: ``(M,)`` load in each segment.
        initial_soc: State of charge at the first edge, 0 to 1.
        charge_efficiency: Converter efficiency into the battery.
        discharge_efficiency: Converter efficiency out of it.
    """
    span = float(edges_s[-1] - edges_s[0])
    step = max(CIRCUIT_STEP_S, span / MAX_CIRCUIT_STEPS)
    per_second = 1.0 / (battery.capacity_ah * 3600.0)
    soc = min(max(initial_soc, 0.0), 1.0)
    times: list[float] = []
    socs: list[float] = []
    volts: list[float] = []
    amps: list[float] = []
    unmet_spans: list[float] = []
    shunted = unmet = loss = 0.0
    efficiencies = (charge_efficiency, discharge_efficiency)
    net_w = (generation_w - load_w).tolist()
    for k, bus_w in enumerate(net_w):
        start, end = float(edges_s[k]), float(edges_s[k + 1])
        count = max(int(math.ceil((end - start) / step)), 1)
        h = (end - start) / count
        if h <= 0:
            continue
        for n in range(count):
            t = start + n * h
            current, voltage, _, _ = battery.flow(soc, bus_w, *efficiencies)
            times.append(t)
            socs.append(soc)
            volts.append(voltage)
            amps.append(current)
            middle = soc - current * per_second * h / 2
            # At an end of the range the midpoint would read a battery that has stopped, and
            # the step would never arrive there; the rate at the start of the step is used.
            inside = 0.0 < middle < 1.0
            current, _, short_w, spare_w = battery.flow(
                middle if inside else soc, bus_w, *efficiencies
            )
            soc = min(max(soc - current * per_second * h, 0.0), 1.0)
            hours = h / 3600.0
            shunted += spare_w * hours
            loss += current * current * battery.resistance_ohm * hours
            if short_w > 0:
                unmet += short_w * hours
                if unmet_spans and unmet_spans[-1] >= t:
                    unmet_spans[-1] = t + h
                else:
                    unmet_spans += [t, t + h]
        current, voltage, _, _ = battery.flow(soc, bus_w, *efficiencies)
        times.append(end)
        socs.append(soc)
        volts.append(voltage)
        amps.append(current)

    time_s, level = np.array(times), np.array(socs)
    voltage_v, current_a = np.array(volts), np.array(amps)
    # Two samples per time bucket, its first and last, keep the jumps and bound the size.
    bucket = np.floor((time_s - time_s[0]) / max(span / TRACE_BUCKETS, 1e-9)).astype(int)
    keep = np.ones(len(time_s), dtype=bool)
    keep[1:-1] = (bucket[1:-1] != bucket[:-2]) | (bucket[1:-1] != bucket[2:])
    return CircuitTrace(
        time_s=time_s[keep],
        soc=level[keep],
        voltage_v=voltage_v[keep],
        current_a=current_a[keep],
        shunted_wh=shunted,
        unmet_wh=unmet,
        loss_wh=loss,
        min_soc=float(level.min()),
        min_voltage_v=float(voltage_v.min()),
        max_voltage_v=float(voltage_v.max()),
        max_discharge_a=float(max(current_a.max(), 0.0)),
        max_charge_a=float(max(-current_a.min(), 0.0)),
        unmet_s=unmet_spans,
        full_time_s=time_s,
        full_soc=level,
    )
