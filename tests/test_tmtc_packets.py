import pytest

from soda.tmtc.packets import (
    APID_HK,
    APID_TC,
    Code,
    Command,
    Event,
    EventReport,
    Housekeeping,
    Mode,
    Packet,
    PacketError,
    PacketType,
)


def test_primary_header_layout():
    raw = Packet(PacketType.TC, APID_TC, 5, False, b"\x01").encode()
    # version 0, type 1, no secondary header, APID 200; unsegmented, count 5; length 0.
    assert raw.hex() == "10c8c0050000" + "01"


def test_sequence_count_wraps_at_14_bits():
    raw = Packet(PacketType.TM, 1, (1 << 14) + 3, False, b"\x00").encode()
    assert Packet.decode(raw).seq == 3


def test_housekeeping_round_trip():
    hk = Housekeeping(1_790_000_000_123, Mode.IMAGING, 7, 1, 64, 12)
    packet = Packet.decode(hk.packet(9).encode())
    assert packet.apid == APID_HK and packet.secondary and packet.seq == 9
    assert Housekeeping.parse(packet) == hk


def test_event_round_trip():
    event = EventReport(5_000, Event.REJECTED, int(Code.SET_MODE))
    assert EventReport.parse(Packet.decode(event.packet(0).encode())) == event


@pytest.mark.parametrize(
    "command",
    [
        Command(Code.NOOP),
        Command(Code.SET_MODE, mode=Mode.SAFE),
        Command(Code.TIME_TAG, execute_ms=123_456, inner=Command(Code.SET_MODE, mode=Mode.IMAGING)),
    ],
)
def test_command_round_trip(command):
    assert Command.parse(Packet.decode(command.packet(1).encode())) == command


def test_malformed_packets_are_refused():
    good = Command(Code.NOOP).packet(0).encode()
    with pytest.raises(PacketError):
        Packet.decode(good[:-1])
    with pytest.raises(PacketError):
        Packet.decode(good + b"\x00")
    with pytest.raises(PacketError):
        Command.parse_body(bytes([Code.SET_MODE, 9]))
    nested = Command(Code.TIME_TAG, execute_ms=1, inner=Command(Code.NOOP)).body()
    with pytest.raises(PacketError):
        Command.parse_body(bytes([Code.TIME_TAG]) + (2).to_bytes(8, "big") + nested)
