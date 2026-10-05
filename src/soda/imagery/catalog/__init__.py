"""Public imagery catalogues the server can search and fetch from on the user's behalf.

Two sources, both open without a login: Maxar Open Data (a static STAC on S3) and
OpenAerialMap (a search API). The browser never talks to them; it asks SODA, and SODA makes
the requests. A client names what to import by catalogue item id only. The server looks the
download address up in the catalogue itself, and only ever requests the hosts listed in
``http.ALLOWED_HOSTS``.
"""

from dataclasses import asdict, dataclass
from typing import Any

SOURCES = ("maxar", "oam")


@dataclass(frozen=True)
class Candidate:
    """One catalogue item a search found."""

    source: str
    item_id: str
    title: str
    west_deg: float
    south_deg: float
    east_deg: float
    north_deg: float
    #: Ground sample distance; ``None`` when the search did not look the item up.
    gsd_m: float | None
    acquired_at: str | None
    license: str
    attribution: str
    size_bytes: int | None
    pixels: int | None
    clouds_percent: float | None
    #: False when SODA would refuse to fetch the item; ``reason`` says why.
    importable: bool = True
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Resolved:
    """Where an item's image is, and what to record about the set made from it."""

    url: str
    name: str
    attribution: str
    license: str
    acquired_at: str | None
    #: Ground sample distance the catalogue states, which can be coarser than the pixels of a
    #: resampled product; ``None`` when it does not say.
    gsd_m: float | None = None


def intersects(a: tuple[float, float, float, float], b: list[float] | tuple[float, ...]) -> bool:
    """Whether two ``(west, south, east, north)`` boxes overlap."""
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]
