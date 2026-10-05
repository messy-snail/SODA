"""Ground contact plan: passes of several satellites over shared stations, deconflicted.

A station antenna tracks one satellite at a time and needs ``turnaround_s`` after LOS to
slew and reconfigure, so two contacts at one station conflict when ``[aos, los +
turnaround)`` intervals overlap. Contacts are handed out greedily by satellite priority
(the order the satellites were given), then by AOS; a contact that collides with one
already assigned is rejected. Pure functions, so the rules are testable without DE421.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..errors import CodedError
from .passes import MAX_PASS_WINDOW

MAX_SATELLITES = 8
#: Satellite-days searched per request: about five seconds over eight stations.
MAX_SATELLITE_DAYS = 60
DEFAULT_TURNAROUND_S = 60.0
MAX_TURNAROUND_S = 3600.0


class ContactRequestError(CodedError, ValueError):
    """The satellite list or a satellite's window is outside the supported limits."""


def check_request(windows: Sequence[tuple[datetime, datetime]]) -> None:
    """Validate the satellites' search windows before any propagation.

    Raises:
        ContactRequestError: No satellites, too many, or a window out of range.
    """
    if not windows:
        raise ContactRequestError("noSatelliteSelected", "위성을 하나 이상 지정 필요")
    if len(windows) > MAX_SATELLITES:
        raise ContactRequestError(
            "tooManySatellites",
            f"위성은 한 번에 최대 {MAX_SATELLITES}개",
            max=MAX_SATELLITES,
        )
    for start, end in windows:
        if end <= start:
            raise ContactRequestError("endBeforeStart", "종료 시각은 시작 시각보다 늦어야 함")
        if end - start > MAX_PASS_WINDOW:
            raise ContactRequestError(
                "passWindowTooLong",
                f"패스 예측 기간은 최대 {MAX_PASS_WINDOW.days}일",
                days=MAX_PASS_WINDOW.days,
            )
    days = sum((end - start).total_seconds() for start, end in windows) / 86_400
    if days > MAX_SATELLITE_DAYS:
        raise ContactRequestError(
            "passBudgetExceeded",
            f"위성 수 × 기간이 최대 {MAX_SATELLITE_DAYS}일 초과 · 위성이나 기간을 줄여야 함",
            max=MAX_SATELLITE_DAYS,
        )


@dataclass
class Contact:
    """One pass of one satellite over one station, and what the plan made of it."""

    id: str
    satellite: int
    station_id: int
    aos: datetime
    los: datetime
    assigned: bool = False
    conflict_with: list[str] = field(default_factory=list)


def contact_id(satellite: int, station_id: int, aos: datetime) -> str:
    """Stable key: satellite priority index, station, and AOS to the millisecond."""
    return f"{satellite}:{station_id}:{aos.isoformat(timespec='milliseconds')}"


def _busy_until(contact: Contact, turnaround_s: float) -> datetime:
    return contact.los + timedelta(seconds=turnaround_s)


def _overlap(a: Contact, b: Contact, turnaround_s: float) -> bool:
    return a.aos < _busy_until(b, turnaround_s) and b.aos < _busy_until(a, turnaround_s)


def schedule(contacts: Sequence[Contact], turnaround_s: float) -> list[Contact]:
    """Mark conflicts and assign contacts; returns them sorted by AOS.

    Every contact lists all others at the same station it overlaps, assigned or not.
    Assignment walks satellites in priority order and each satellite's passes in time
    order, keeping a contact only when nothing assigned at its station overlaps it.
    """
    by_station: dict[int, list[Contact]] = {}
    for contact in contacts:
        contact.assigned = False
        contact.conflict_with = []
        by_station.setdefault(contact.station_id, []).append(contact)
    for group in by_station.values():
        group.sort(key=lambda c: c.aos)
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                # Sorted by AOS: once one starts after ``a`` frees up, the rest do too.
                if b.aos >= _busy_until(a, turnaround_s):
                    break
                a.conflict_with.append(b.id)
                b.conflict_with.append(a.id)

    assigned: dict[int, list[Contact]] = {}
    for contact in sorted(contacts, key=lambda c: (c.satellite, c.aos)):
        taken = assigned.setdefault(contact.station_id, [])
        if any(_overlap(contact, other, turnaround_s) for other in taken):
            continue
        contact.assigned = True
        taken.append(contact)
    return sorted(contacts, key=lambda c: (c.aos, c.satellite, c.station_id))
