"""One simulated pass schedule, stepped along the frontend's Cesium clock.

The browser owns simulation time (invariant 9): it reports the clock, and the session
catches the spacecraft up to that instant, event by event (AOS, LOS, housekeeping ticks,
time-tagged commands). Telemetry produced while no station sees the spacecraft is kept
onboard and played back at the next AOS; telecommands sent then wait on the ground until
the link opens. Moving the clock backwards starts the spacecraft over.
"""

from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .link import Contact, LinkSchedule
from .packets import (
    APID_EVENT,
    APID_HK,
    APID_TC,
    Command,
    EventReport,
    Housekeeping,
    Packet,
    PacketType,
)
from .spacecraft import Spacecraft

#: Housekeeping cadence in simulation time.
HK_PERIOD_MS = 10_000
#: Onboard telemetry kept for playback; the oldest goes first. Two hours of housekeeping.
MAX_ONBOARD = 720
#: Packets reported to the client per clock update; the rest are only counted.
MAX_REPORTED = 300
#: A clock step back further than this restarts the spacecraft.
REWIND_TOLERANCE_MS = 1000


@dataclass
class _Sent:
    packet: Packet
    time_ms: int
    replay: bool = False


@dataclass
class Session:
    """Simulation of one spacecraft over a contact schedule.

    Attributes:
        schedule: When stations see the spacecraft.
        name: Shown in the UI and the packet log.
    """

    schedule: LinkSchedule
    name: str = ""
    spacecraft: Spacecraft = field(default_factory=Spacecraft)
    now_ms: int | None = None
    link_open: bool = False
    uplink_queue: list[Command] = field(default_factory=list)
    onboard: deque[_Sent] = field(default_factory=lambda: deque(maxlen=MAX_ONBOARD))
    last_hk: Housekeeping | None = None
    _seq: dict[int, int] = field(default_factory=dict)
    _next_hk_ms: int = 0

    @classmethod
    def over(cls, contacts: Iterable[Contact], name: str = "") -> "Session":
        return cls(LinkSchedule(list(contacts)), name)

    # Clock ------------------------------------------------------------------------

    def advance(self, now_ms: int) -> list[dict[str, Any]]:
        """Catch up to ``now_ms``; returns the messages for the client, in time order."""
        out: list[dict[str, Any]] = []
        if self.now_ms is None or now_ms < self.now_ms - REWIND_TOLERANCE_MS:
            restarted = self.now_ms is not None
            self._restart(now_ms)
            if restarted:
                out.append({"type": "reset", "time_ms": now_ms})
            out.append(self._link_message())
            return self._report(self._housekeeping(), out)
        sent: list[_Sent] = []
        while self.now_ms < now_ms:
            step_to = min(
                t
                for t in (
                    now_ms,
                    self._next_hk_ms,
                    self.schedule.next_edge(self.now_ms),
                    self.spacecraft.next_due_ms(),
                )
                if t is not None and t > self.now_ms
            )
            events = self.spacecraft.advance(
                (step_to - self.now_ms) / 1000, self.link_open, step_to
            )
            self.now_ms = step_to
            sent += self._telemetry(events)
            sent += self._edges(out)
            for command in self.spacecraft.due(step_to):
                sent += self._telemetry(self.spacecraft.execute(command, step_to))
            if step_to >= self._next_hk_ms:
                sent += self._housekeeping()
        return self._report(sent, out)

    def _housekeeping(self) -> list[_Sent]:
        assert self.now_ms is not None
        self.last_hk = self.spacecraft.housekeeping(self.now_ms)
        self._next_hk_ms = self.now_ms + HK_PERIOD_MS
        return self._telemetry([self.last_hk])

    def _restart(self, now_ms: int) -> None:
        self.spacecraft = Spacecraft()
        self.uplink_queue.clear()
        self.onboard.clear()
        self.now_ms = now_ms
        self.link_open = self.schedule.open_at(now_ms) is not None
        self._next_hk_ms = now_ms
        self.last_hk = None

    def _edges(self, out: list[dict[str, Any]]) -> list[_Sent]:
        """Open or close the link when the clock crossed an AOS or LOS."""
        assert self.now_ms is not None
        is_open = self.schedule.open_at(self.now_ms) is not None
        if is_open == self.link_open:
            return []
        self.link_open = is_open
        sent: list[_Sent] = []
        if is_open:
            sent = [_Sent(s.packet, self.now_ms, replay=True) for s in self.onboard]
            self.onboard.clear()
            queued, self.uplink_queue = self.uplink_queue, []
            for command in queued:
                sent += self._uplink(command)
        # After the playback and the queued commands, so the counts it carries are current.
        out.append(self._link_message())
        return sent

    # Commands ---------------------------------------------------------------------

    def submit(self, command: Command) -> list[dict[str, Any]]:
        """A telecommand from the ground: sent now if the link is open, else queued."""
        if self.now_ms is None:
            return [{"type": "queued", "command": command.describe(), "queued": 1}]
        if not self.link_open:
            self.uplink_queue.append(command)
            return [
                {
                    "type": "queued",
                    "command": command.describe(),
                    "queued": len(self.uplink_queue),
                }
            ]
        return self._report(self._uplink(command), [])

    def _uplink(self, command: Command) -> list[_Sent]:
        assert self.now_ms is not None
        sent = [_Sent(command.packet(self._next_seq(APID_TC)), self.now_ms)]
        return sent + self._telemetry(self.spacecraft.execute(command, self.now_ms))

    # Telemetry --------------------------------------------------------------------

    def _telemetry(self, items: Iterable[Housekeeping | EventReport]) -> list[_Sent]:
        """Packets for these items: downlinked now, or kept onboard while out of contact."""
        assert self.now_ms is not None
        sent = []
        for item in items:
            apid = APID_HK if isinstance(item, Housekeeping) else APID_EVENT
            record = _Sent(item.packet(self._next_seq(apid)), self.now_ms)
            if self.link_open:
                sent.append(record)
            else:
                self.onboard.append(record)
        return sent

    def _next_seq(self, apid: int) -> int:
        seq = self._seq.get(apid, 0)
        self._seq[apid] = seq + 1
        return seq

    def _report(self, sent: list[_Sent], out: list[dict[str, Any]]) -> list[dict[str, Any]]:
        dropped = max(0, len(sent) - MAX_REPORTED)
        packets = [packet_message(s.packet, s.time_ms, s.replay) for s in sent[dropped:]]
        if dropped:
            packets.insert(0, {"type": "dropped", "count": dropped})
        return out + packets

    def _link_message(self) -> dict[str, Any]:
        assert self.now_ms is not None
        contact = self.schedule.open_at(self.now_ms)
        return {
            "type": "link",
            "open": self.link_open,
            "time_ms": self.now_ms,
            "station_id": contact.station_id if contact else None,
            "delay_ms": round(contact.delay_ms, 3) if contact else None,
            "next_aos_ms": self.schedule.next_aos(self.now_ms),
            "queued": len(self.uplink_queue),
            "onboard": len(self.onboard),
        }

    def status(self) -> dict[str, Any]:
        """Snapshot for a client that just connected."""
        hk = self.last_hk
        return {
            "type": "status",
            "name": self.name,
            "contacts": [
                {
                    "aos_ms": c.aos_ms,
                    "los_ms": c.los_ms,
                    "station_id": c.station_id,
                    "track_fixed_m": c.track_fixed_m,
                }
                for c in self.schedule.contacts
            ],
            "link": self._link_message() if self.now_ms is not None else None,
            "hk": hk_fields(hk) if hk else None,
        }


def hk_fields(hk: Housekeeping) -> dict[str, Any]:
    return {
        "time_ms": hk.time_ms,
        "mode": hk.mode.name,
        "command_count": hk.command_count,
        "rejected_count": hk.rejected_count,
        "battery_pct": hk.battery_pct,
        "storage_pct": hk.storage_pct,
    }


def packet_message(packet: Packet, time_ms: int, replay: bool = False) -> dict[str, Any]:
    """A packet as the client's log shows it, raw bytes included."""
    decoded: dict[str, Any]
    if packet.type == PacketType.TC:
        decoded = Command.parse(packet).describe()
    elif packet.apid == APID_HK:
        decoded = hk_fields(Housekeeping.parse(packet))
    else:
        event = EventReport.parse(packet)
        decoded = {"time_ms": event.time_ms, "event": event.event.name, "code": event.code}
    return {
        "type": "packet",
        "dir": "up" if packet.type == PacketType.TC else "down",
        "apid": packet.apid,
        "seq": packet.seq,
        "time_ms": time_ms,
        "replay": replay,
        "hex": packet.encode().hex(),
        "decoded": decoded,
    }
