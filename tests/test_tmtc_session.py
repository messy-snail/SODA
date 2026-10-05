from soda.tmtc.link import Contact, LinkSchedule
from soda.tmtc.packets import Code, Command, Mode
from soda.tmtc.session import HK_PERIOD_MS, Session

MIN = 60_000
#: One contact from minute 10 to minute 20, at 1000 km.
CONTACT = Contact(10 * MIN, 20 * MIN, 7, 1000.0)


def packets(messages, direction=None):
    return [
        m
        for m in messages
        if m["type"] == "packet" and (direction is None or m["dir"] == direction)
    ]


def started(at_ms=0):
    session = Session.over([CONTACT], "SAT")
    session.advance(at_ms)
    return session


def test_schedule_lookups():
    schedule = LinkSchedule([CONTACT])
    assert schedule.open_at(10 * MIN) is CONTACT
    assert schedule.open_at(20 * MIN) is None
    assert schedule.next_aos(0) == 10 * MIN and schedule.next_aos(10 * MIN) is None
    assert CONTACT.delay_ms == 1000 / 299_792.458 * 1000


def test_no_telemetry_reaches_the_ground_out_of_contact():
    session = started()
    assert packets(session.advance(5 * MIN)) == []
    assert len(session.onboard) == 5 * MIN // HK_PERIOD_MS + 1


def test_stored_telemetry_is_played_back_at_aos():
    session = started()
    session.advance(5 * MIN)
    stored = len(session.onboard)
    messages = session.advance(11 * MIN)
    link = [m for m in messages if m["type"] == "link"]
    assert link and link[0]["open"] and link[0]["station_id"] == 7
    assert link[0]["onboard"] == 0 and link[0]["queued"] == 0
    replayed = [m for m in packets(messages, "down") if m["replay"]]
    assert len(replayed) >= stored
    assert all(m["time_ms"] == 10 * MIN for m in replayed)
    live = [m for m in packets(messages, "down") if not m["replay"]]
    assert live and all(m["decoded"]["mode"] == "NOMINAL" for m in live if m["apid"] == 100)
    assert session.onboard == type(session.onboard)(maxlen=session.onboard.maxlen)


def test_commands_wait_for_the_link():
    session = started()
    queued = session.submit(Command(Code.SET_MODE, mode=Mode.IMAGING))
    assert queued[0]["type"] == "queued" and session.spacecraft.mode == Mode.NOMINAL
    messages = session.advance(10 * MIN + 1)
    uplinked = packets(messages, "up")
    assert uplinked and uplinked[0]["decoded"]["command"] == "SET_MODE"
    assert session.spacecraft.mode == Mode.IMAGING
    events = [m for m in packets(messages, "down") if m["apid"] == 101 and not m["replay"]]
    assert events[0]["decoded"]["event"] == "EXECUTED"


def test_commands_go_straight_up_in_contact():
    session = started(15 * MIN)
    messages = session.submit(Command(Code.NOOP))
    assert [m["dir"] for m in packets(messages)] == ["up", "down"]
    assert session.spacecraft.command_count == 1


def test_time_tagged_command_runs_onboard_later():
    session = started(15 * MIN)
    tag = Command(Code.TIME_TAG, execute_ms=30 * MIN, inner=Command(Code.SET_MODE, mode=Mode.SAFE))
    session.submit(tag)
    session.advance(29 * MIN)
    assert session.spacecraft.mode == Mode.NOMINAL
    session.advance(31 * MIN)
    assert session.spacecraft.mode == Mode.SAFE
    # Out of contact, the execution report waits onboard for the next pass.
    assert any(s.packet.apid == 101 for s in session.onboard)


def test_moving_the_clock_back_starts_over():
    session = started()
    session.submit(Command(Code.NOOP))
    session.advance(15 * MIN)
    assert session.spacecraft.command_count == 1
    messages = session.advance(1 * MIN)
    assert messages[0]["type"] == "reset"
    assert session.spacecraft.command_count == 0 and not session.uplink_queue


def test_a_long_jump_reports_a_bounded_number_of_packets():
    session = Session.over([Contact(0, 3 * 86_400_000, 7, 1000.0)])
    session.advance(0)
    messages = session.advance(2 * 86_400_000)
    assert len(packets(messages)) <= 300
    assert any(m["type"] == "dropped" for m in messages)
