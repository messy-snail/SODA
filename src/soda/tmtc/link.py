"""When the ground can talk to the spacecraft: its contacts and their light time."""

import bisect
from collections.abc import Sequence
from dataclasses import dataclass

SPEED_OF_LIGHT_KM_S = 299_792.458


@dataclass(frozen=True)
class Contact:
    aos_ms: int
    los_ms: int
    station_id: int
    #: Slant range at culmination, used for a representative one-way delay.
    range_km: float
    #: Flat ITRS metres sampled evenly from AOS to LOS, for drawing the line of sight.
    track_fixed_m: tuple[float, ...] = ()

    @property
    def delay_ms(self) -> float:
        return self.range_km / SPEED_OF_LIGHT_KM_S * 1000.0


class LinkSchedule:
    """Contacts merged into one timeline; overlapping contacts count as one open link."""

    def __init__(self, contacts: Sequence[Contact]) -> None:
        self.contacts = sorted(contacts, key=lambda c: c.aos_ms)
        self._starts = [c.aos_ms for c in self.contacts]

    def open_at(self, ms: int) -> Contact | None:
        """A contact in progress at ``ms`` (AOS inclusive, LOS exclusive), if any."""
        index = bisect.bisect_right(self._starts, ms)
        for contact in reversed(self.contacts[:index]):
            if contact.los_ms > ms:
                return contact
        return None

    def next_aos(self, ms: int) -> int | None:
        """First AOS strictly after ``ms``."""
        index = bisect.bisect_right(self._starts, ms)
        return self._starts[index] if index < len(self._starts) else None

    def next_edge(self, ms: int) -> int | None:
        """First AOS or LOS strictly after ``ms``."""
        edges = [c.aos_ms for c in self.contacts if c.aos_ms > ms]
        edges += [c.los_ms for c in self.contacts if c.los_ms > ms]
        return min(edges) if edges else None
