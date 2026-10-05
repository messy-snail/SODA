"""A toy spacecraft: a mode, two counters, a battery, a data store, and a command queue.

The numbers are not modelled on any bus; they only move in the directions an operator
expects (imaging drains power and fills the store, safe mode recharges, a downlink empties
the store) so the telemetry has something to show.
"""

from dataclasses import dataclass, field

from .packets import Code, Command, Event, EventReport, Housekeeping, Mode

#: Battery change in percent per second, by mode.
BATTERY_RATE = {Mode.SAFE: 0.02, Mode.NOMINAL: -0.005, Mode.IMAGING: -0.03}
STORAGE_FILL_RATE = 0.05
STORAGE_DOWNLINK_RATE = 0.2
#: Below this the spacecraft drops to safe mode on its own.
LOW_BATTERY_PCT = 5.0
#: Imaging is refused below this.
IMAGING_MIN_BATTERY_PCT = 10.0


@dataclass
class Spacecraft:
    mode: Mode = Mode.NOMINAL
    command_count: int = 0
    rejected_count: int = 0
    battery_pct: float = 80.0
    storage_pct: float = 10.0
    #: Time-tagged commands waiting onboard, earliest first.
    pending: list[Command] = field(default_factory=list)

    def advance(self, seconds: float, downlinking: bool, now_ms: int) -> list[EventReport]:
        """Let ``seconds`` pass; returns an event if the battery forced safe mode."""
        charge = BATTERY_RATE[self.mode] * seconds
        self.battery_pct = min(100.0, max(0.0, self.battery_pct + charge))
        fill = STORAGE_FILL_RATE if self.mode == Mode.IMAGING else 0.0
        drain = STORAGE_DOWNLINK_RATE if downlinking else 0.0
        self.storage_pct = min(100.0, max(0.0, self.storage_pct + (fill - drain) * seconds))
        if self.mode != Mode.SAFE and self.battery_pct < LOW_BATTERY_PCT:
            self.mode = Mode.SAFE
            return [EventReport(now_ms, Event.EXECUTED, Code.SET_MODE)]
        return []

    def execute(self, command: Command, now_ms: int) -> list[EventReport]:
        """Run a command now; a time tag is stored to run later."""
        if command.code == Code.TIME_TAG:
            assert command.execute_ms is not None and command.inner is not None
            if command.execute_ms <= now_ms:
                return self._reject(command, now_ms)
            self.pending.append(command)
            self.pending.sort(key=lambda c: c.execute_ms or 0)
            return self._accept(command, now_ms)
        if command.code == Code.SET_MODE:
            imaging = command.mode == Mode.IMAGING
            if imaging and self.battery_pct < IMAGING_MIN_BATTERY_PCT:
                return self._reject(command, now_ms)
            assert command.mode is not None
            self.mode = command.mode
        return self._accept(command, now_ms)

    def due(self, now_ms: int) -> list[Command]:
        """Time-tagged commands whose time has come, removed from the queue."""
        ready = [c for c in self.pending if (c.execute_ms or 0) <= now_ms]
        self.pending = [c for c in self.pending if (c.execute_ms or 0) > now_ms]
        return [c.inner for c in ready if c.inner is not None]

    def next_due_ms(self) -> int | None:
        return self.pending[0].execute_ms if self.pending else None

    def housekeeping(self, now_ms: int) -> Housekeeping:
        return Housekeeping(
            now_ms,
            self.mode,
            self.command_count,
            self.rejected_count,
            round(self.battery_pct),
            round(self.storage_pct),
        )

    def _accept(self, command: Command, now_ms: int) -> list[EventReport]:
        self.command_count += 1
        return [EventReport(now_ms, Event.EXECUTED, int(command.code))]

    def _reject(self, command: Command, now_ms: int) -> list[EventReport]:
        self.rejected_count += 1
        return [EventReport(now_ms, Event.REJECTED, int(command.code))]
