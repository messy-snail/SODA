from datetime import UTC, datetime, timedelta

from soda.orbit.contacts import Contact, contact_id, schedule

T0 = datetime(2026, 9, 16, tzinfo=UTC)


def make(satellite: int, station: int, start_min: float, length_min: float) -> Contact:
    aos = T0 + timedelta(minutes=start_min)
    return Contact(
        contact_id(satellite, station, aos),
        satellite,
        station,
        aos,
        aos + timedelta(minutes=length_min),
    )


def by_id(contacts):
    return {c.id: c for c in contacts}


def test_higher_priority_wins_an_overlap():
    first, second = make(0, 1, 10, 8), make(1, 1, 5, 8)
    result = by_id(schedule([second, first], 60))
    assert result[first.id].assigned and not result[second.id].assigned
    assert result[first.id].conflict_with == [second.id]
    assert result[second.id].conflict_with == [first.id]


def test_different_stations_never_conflict():
    a, b = make(0, 1, 0, 10), make(1, 2, 0, 10)
    result = schedule([a, b], 60)
    assert all(c.assigned and not c.conflict_with for c in result)


def test_turnaround_separates_back_to_back_contacts():
    a, b = make(0, 1, 0, 10), make(1, 1, 10.5, 5)
    assert all(c.assigned for c in schedule([a, b], 0))
    result = by_id(schedule([a, b], 60))
    assert result[a.id].assigned and not result[b.id].assigned
    assert result[b.id].conflict_with == [a.id]


def test_rejected_contact_does_not_block_others():
    """A lower-priority pass that lost its slot must not knock out a third one."""
    high = make(0, 1, 0, 10)
    low = make(1, 1, 9, 10)
    third = make(2, 1, 18, 5)
    result = by_id(schedule([third, low, high], 0))
    assert result[high.id].assigned
    assert not result[low.id].assigned
    assert result[third.id].assigned
    assert result[low.id].conflict_with == [high.id, third.id]


def test_one_satellite_keeps_time_order_within_its_priority():
    early, late = make(0, 1, 0, 10), make(0, 1, 5, 10)
    result = by_id(schedule([late, early], 0))
    assert result[early.id].assigned and not result[late.id].assigned


def test_result_is_sorted_by_aos():
    contacts = [make(1, 1, 30, 5), make(0, 2, 10, 5), make(0, 1, 20, 5)]
    assert [c.aos for c in schedule(contacts, 60)] == sorted(c.aos for c in contacts)
