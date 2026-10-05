"""CCSDS Space Packets (CCSDS 133.0-B) for the simulated spacecraft.

Primary header, big-endian, 6 bytes::

    version(3)=0 | type(1) | secondary header flag(1) | APID(11)
    sequence flags(2)=0b11 (unsegmented) | sequence count(14)
    data length(16) = bytes after the primary header - 1

Telemetry carries an 8-byte secondary header: the onboard time as UTC milliseconds. A
telecommand's data field is a one-byte command code followed by its arguments.
"""

import struct
from dataclasses import dataclass
from enum import IntEnum

PRIMARY = struct.Struct(">HHH")
TIME = struct.Struct(">Q")
#: mode, command count, rejected count, battery %, storage %.
HK = struct.Struct(">BHHBB")
#: event code, command code.
EVENT = struct.Struct(">BB")
SEQ_MODULO = 1 << 14
MAX_APID = (1 << 11) - 1

APID_HK = 100
APID_EVENT = 101
APID_TC = 200


class PacketType(IntEnum):
    TM = 0
    TC = 1


class Mode(IntEnum):
    SAFE = 0
    NOMINAL = 1
    IMAGING = 2


class Code(IntEnum):
    NOOP = 1
    SET_MODE = 2
    TIME_TAG = 3


class Event(IntEnum):
    EXECUTED = 1
    REJECTED = 2


class PacketError(ValueError):
    """Bytes that are not a well-formed packet of this mission."""


@dataclass(frozen=True)
class Packet:
    type: PacketType
    apid: int
    seq: int
    secondary: bool
    data: bytes

    def encode(self) -> bytes:
        """The packet on the wire."""
        if not 0 <= self.apid <= MAX_APID:
            raise PacketError(f"APID out of range: {self.apid}")
        if not self.data:
            raise PacketError("a packet carries at least one data byte")
        first = (int(self.type) << 12) | (int(self.secondary) << 11) | self.apid
        second = (0b11 << 14) | (self.seq % SEQ_MODULO)
        return PRIMARY.pack(first, second, len(self.data) - 1) + self.data

    @classmethod
    def decode(cls, raw: bytes) -> "Packet":
        """Parse one packet; the length field must match the bytes given."""
        if len(raw) < PRIMARY.size + 1:
            raise PacketError("shorter than a primary header and one data byte")
        first, second, length = PRIMARY.unpack_from(raw)
        if first >> 13:
            raise PacketError("unsupported packet version")
        data = raw[PRIMARY.size :]
        if len(data) != length + 1:
            raise PacketError("length field does not match the packet")
        return cls(
            type=PacketType((first >> 12) & 1),
            apid=first & MAX_APID,
            seq=second & (SEQ_MODULO - 1),
            secondary=bool((first >> 11) & 1),
            data=data,
        )


@dataclass(frozen=True)
class Housekeeping:
    time_ms: int
    mode: Mode
    command_count: int
    rejected_count: int
    battery_pct: int
    storage_pct: int

    def packet(self, seq: int) -> Packet:
        body = HK.pack(
            int(self.mode),
            self.command_count & 0xFFFF,
            self.rejected_count & 0xFFFF,
            self.battery_pct,
            self.storage_pct,
        )
        return Packet(PacketType.TM, APID_HK, seq, True, TIME.pack(self.time_ms) + body)

    @classmethod
    def parse(cls, packet: Packet) -> "Housekeeping":
        (time_ms,) = TIME.unpack_from(packet.data)
        mode, commands, rejected, battery, storage = HK.unpack_from(packet.data, TIME.size)
        return cls(time_ms, Mode(mode), commands, rejected, battery, storage)


@dataclass(frozen=True)
class EventReport:
    time_ms: int
    event: Event
    code: int

    def packet(self, seq: int) -> Packet:
        body = TIME.pack(self.time_ms) + EVENT.pack(int(self.event), self.code)
        return Packet(PacketType.TM, APID_EVENT, seq, True, body)

    @classmethod
    def parse(cls, packet: Packet) -> "EventReport":
        (time_ms,) = TIME.unpack_from(packet.data)
        event, code = EVENT.unpack_from(packet.data, TIME.size)
        return cls(time_ms, Event(event), code)


@dataclass(frozen=True)
class Command:
    """A telecommand. ``TIME_TAG`` wraps another command to run at ``execute_ms``."""

    code: Code
    mode: Mode | None = None
    execute_ms: int | None = None
    inner: "Command | None" = None

    def body(self) -> bytes:
        if self.code == Code.NOOP:
            return bytes([Code.NOOP])
        if self.code == Code.SET_MODE:
            if self.mode is None:
                raise PacketError("SET_MODE needs a mode")
            return bytes([Code.SET_MODE, int(self.mode)])
        if self.execute_ms is None or self.inner is None or self.inner.code == Code.TIME_TAG:
            raise PacketError("TIME_TAG needs a time and one plain command")
        return bytes([Code.TIME_TAG]) + TIME.pack(self.execute_ms) + self.inner.body()

    def packet(self, seq: int) -> Packet:
        return Packet(PacketType.TC, APID_TC, seq, False, self.body())

    @classmethod
    def parse_body(cls, body: bytes) -> "Command":
        try:
            code = Code(body[0])
            if code == Code.NOOP:
                return cls(code)
            if code == Code.SET_MODE:
                return cls(code, mode=Mode(body[1]))
            (execute_ms,) = TIME.unpack_from(body, 1)
            inner = cls.parse_body(body[1 + TIME.size :])
        except (IndexError, ValueError, struct.error) as error:
            raise PacketError(f"malformed command: {body.hex()}") from error
        if inner.code == Code.TIME_TAG:
            raise PacketError("time tags do not nest")
        return cls(code, execute_ms=execute_ms, inner=inner)

    @classmethod
    def parse(cls, packet: Packet) -> "Command":
        if packet.type != PacketType.TC or packet.apid != APID_TC:
            raise PacketError("not a telecommand of this mission")
        return cls.parse_body(packet.data)

    def describe(self) -> dict:
        """JSON-friendly form for the packet log."""
        out: dict = {"command": self.code.name}
        if self.mode is not None:
            out["mode"] = self.mode.name
        if self.execute_ms is not None:
            out["execute_ms"] = self.execute_ms
        if self.inner is not None:
            out["inner"] = self.inner.describe()
        return out
