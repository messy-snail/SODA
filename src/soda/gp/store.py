"""Storage boundary for element sets, fetch bookkeeping, stations, presets, and user elements.

``Store`` is the contract every backend implements; ``open_store`` picks one from a URL.
SQLite (``sqlite_store.SqliteStore``) is the only backend shipped today. A new backend adds a
scheme to ``open_store`` and a parameter to the ``store`` fixture in ``tests/test_store.py``,
whose tests are the executable form of the contract below.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from .models import ElementSet, normalize_omm
from .sources import CustomEphemeris, CustomState

#: URL schemes ``open_store`` understands.
SUPPORTED_SCHEMES = ("sqlite",)


@dataclass(frozen=True)
class FetchRecord:
    source: str
    key: str
    last_attempt_at: datetime
    last_ok_at: datetime | None
    last_status: str
    detail: str
    consecutive_errors: int
    object_count: int


@dataclass(frozen=True)
class Station:
    id: int
    name: str
    lat_deg: float
    lon_deg: float
    alt_m: float
    min_elev_deg: float
    #: Catalog entry this station was created from, or ``None`` when hand-entered.
    preset_id: str | None = None
    #: Horizon mask vertices as ``(az_deg, min_elev_deg)``; empty means a uniform horizon.
    az_mask: tuple[tuple[float, float], ...] = ()


class StationNameTaken(Exception):
    """Raised by ``add_station``/``update_station`` when another station has the name."""


@dataclass(frozen=True)
class SensorPreset:
    """A sensor the user saved for reuse in swath runs."""

    id: int
    name: str
    #: Which width drives the swath: ``"swath"`` (``swath_km``) or ``"fov"`` (``fov_deg``).
    mode: str
    swath_km: float
    fov_deg: float
    max_off_nadir_deg: float
    min_sun_elev_deg: float


class SensorPresetNameTaken(Exception):
    """Raised by ``add_sensor_preset``/``update_sensor_preset`` when the name is in use."""


@dataclass(frozen=True)
class CustomElements:
    """Orbital elements the user pasted in, kept apart from the downloaded catalog."""

    id: int
    name: str
    #: Normalized OMM fields, as ``normalize_omm`` returns them.
    omm: dict[str, Any]
    #: What the user pasted: ``"tle"`` (2 or 3 lines) or ``"omm"`` (JSON).
    input_format: str
    #: UTC ISO 8601 with a ``Z`` suffix.
    created_at: str

    def element_set(self) -> ElementSet:
        """The elements as the propagator takes them, labelled with the user's name."""
        return replace(normalize_omm(self.omm, "user"), name=self.name)


class CustomElementNameTaken(Exception):
    """Raised by ``add_custom_element`` when another entry has the name."""


@dataclass(frozen=True)
class TableInfo:
    """A table the settings screen can browse."""

    name: str
    columns: tuple[str, ...]
    count: int


@dataclass(frozen=True)
class BrowsePage:
    """One page of raw rows; JSON columns (``omm``, ``az_mask``) come back parsed."""

    table: str
    columns: tuple[str, ...]
    rows: list[dict[str, Any]]
    #: Rows matching the search, across all pages.
    total: int


class Store(Protocol):
    """Synchronous repository the GP service and the API talk to.

    Backends must keep these guarantees; the CelesTrak request budget depends on them:

    - Every datetime in and out is timezone-aware UTC.
    - ``upsert_latest`` overwrites a row only when the incoming epoch is the same or newer.
    - ``record_fetch`` resets ``consecutive_errors`` on success and increments it on failure
      in one atomic step, and keeps ``last_ok_at``/``object_count`` when not given.
      ``GPService`` derives its backoff from it, so a lost update means extra requests.
    - Station names are unique; a clash raises ``StationNameTaken``.
    - Sensor preset names are unique; a clash raises ``SensorPresetNameTaken``.
    - Custom element names are unique; a clash raises ``CustomElementNameTaken``.
    - An empty database is seeded with the default station on first open.
    """

    # Element sets
    def upsert_latest(self, elements: Iterable[ElementSet], now: datetime) -> int: ...
    def latest(self, norad_id: int) -> ElementSet | None: ...
    def search(
        self,
        query: str,
        group: str | None,
        limit: int,
        category: Sequence[str] | None = None,
    ) -> list[ElementSet]:
        """Name or NORAD ID matches, optionally within a group and ``classify`` categories."""
        ...

    def group_elements(self, group: str) -> list[ElementSet]: ...
    def replace_group(self, group: str, norad_ids: Iterable[int]) -> None: ...
    def groups_of(self, norad_id: int) -> list[str]: ...
    def group_counts(self) -> dict[str, int]:
        """Cached member count per group; groups never downloaded are absent."""
        ...

    def count_latest(self) -> int: ...
    def add_history(self, elements: Iterable[ElementSet]) -> None: ...
    def history_near(self, norad_id: int, start: datetime, end: datetime) -> list[ElementSet]: ...

    # Fetch bookkeeping
    def fetch_record(self, source: str, key: str) -> FetchRecord | None: ...
    def record_fetch(
        self,
        source: str,
        key: str,
        *,
        at: datetime,
        status: str,
        ok: bool,
        detail: str = "",
        object_count: int | None = None,
    ) -> None: ...
    def fetch_records(self) -> list[FetchRecord]: ...

    # Stations
    def stations(self) -> list[Station]: ...
    def station(self, station_id: int) -> Station | None: ...
    def add_station(
        self,
        name: str,
        lat_deg: float,
        lon_deg: float,
        alt_m: float,
        min_elev_deg: float,
        preset_id: str | None = None,
        az_mask: Sequence[Sequence[float]] = (),
    ) -> Station: ...
    def update_station(
        self,
        station_id: int,
        name: str,
        lat_deg: float,
        lon_deg: float,
        alt_m: float,
        min_elev_deg: float,
        preset_id: str | None = None,
        az_mask: Sequence[Sequence[float]] = (),
    ) -> Station | None: ...
    def delete_station(self, station_id: int) -> bool: ...

    # Sensor presets
    def sensor_presets(self) -> list[SensorPreset]:
        """All saved sensor presets, ordered by id."""
        ...

    def sensor_preset(self, preset_id: int) -> SensorPreset | None:
        """One sensor preset, or ``None`` when the id is unknown."""
        ...

    def add_sensor_preset(
        self,
        name: str,
        mode: str,
        swath_km: float,
        fov_deg: float,
        max_off_nadir_deg: float,
        min_sun_elev_deg: float,
    ) -> SensorPreset:
        """Save a new sensor preset.

        Raises:
            SensorPresetNameTaken: Another preset already has ``name``.
        """
        ...

    def update_sensor_preset(
        self,
        preset_id: int,
        name: str,
        mode: str,
        swath_km: float,
        fov_deg: float,
        max_off_nadir_deg: float,
        min_sun_elev_deg: float,
    ) -> SensorPreset | None:
        """Replace a sensor preset in place, keeping its id.

        Returns:
            The updated preset, or ``None`` when the id is unknown.

        Raises:
            SensorPresetNameTaken: Another preset already has ``name``.
        """
        ...

    def delete_sensor_preset(self, preset_id: int) -> bool:
        """Delete a sensor preset; false when the id is unknown."""
        ...

    # Custom elements
    def custom_elements(self) -> list[CustomElements]:
        """All user-supplied element sets, ordered by id."""
        ...

    def custom_element(self, custom_id: int) -> CustomElements | None:
        """One user-supplied element set, or ``None`` when the id is unknown."""
        ...

    def add_custom_element(
        self, name: str, omm: dict[str, Any], input_format: str
    ) -> CustomElements:
        """Save user-supplied elements that already went through ``normalize_omm``.

        Raises:
            CustomElementNameTaken: Another entry already has ``name``.
        """
        ...

    def add_custom_elements(
        self, items: Sequence[tuple[str, dict[str, Any], str]]
    ) -> list[CustomElements]:
        """Save several ``(name, omm, input_format)`` entries, all of them or none.

        Raises:
            CustomElementNameTaken: A name is already in use; nothing is saved.
        """
        ...

    def delete_custom_element(self, custom_id: int) -> bool:
        """Delete user-supplied elements; false when the id is unknown."""
        ...

    # State vectors
    def custom_states(self) -> list[CustomState]:
        """All user-supplied state vectors, ordered by id."""
        ...

    def custom_state(self, state_id: int) -> CustomState | None:
        """One user-supplied state vector, or ``None`` when the id is unknown."""
        ...

    def add_custom_state(
        self, name: str, epoch: str, frame: str, state: dict[str, Any], input_format: str
    ) -> CustomState:
        """Save a state that is already in GCRS; ``frame`` records what it was given in.

        Raises:
            CustomStateNameTaken: Another entry already has ``name``.
        """
        ...

    def delete_custom_state(self, state_id: int) -> bool:
        """Delete a state vector; false when the id is unknown."""
        ...

    # Ephemerides
    def custom_ephemerides(self) -> list[CustomEphemeris]:
        """All imported ephemerides without their samples, ordered by id."""
        ...

    def custom_ephemeris(self, ephemeris_id: int) -> CustomEphemeris | None:
        """One imported ephemeris with its samples, or ``None`` when the id is unknown."""
        ...

    def add_custom_ephemeris(
        self, name: str, meta: dict[str, Any], start: str, stop: str, samples: bytes, count: int
    ) -> CustomEphemeris:
        """Save an ephemeris whose samples are GCRS float64 rows (see ``CustomEphemeris``).

        Raises:
            CustomEphemerisNameTaken: Another entry already has ``name``.
        """
        ...

    def delete_custom_ephemeris(self, ephemeris_id: int) -> bool:
        """Delete an ephemeris; false when the id is unknown."""
        ...

    # Housekeeping
    def stats(self) -> dict[str, int]:
        """Row counts for the settings screen: ``objects``, ``history``, ``stations``,
        ``sensor_presets``, ``custom_elements``, ``fetches``."""
        ...

    def tables(self) -> list[TableInfo]:
        """Browsable tables with their columns and row counts, for the settings screen."""
        ...

    def browse(self, table: str, offset: int, limit: int, query: str) -> BrowsePage:
        """One page of a table's rows, read-only.

        Raises:
            KeyError: ``table`` is not one of ``tables()``.
        """
        ...

    def backup_to(self, target: Path) -> None:
        """Write a consistent snapshot of the whole database to a local file."""
        ...


#: Tables a SODA database has; a file holding none of them was made by something else.
SODA_TABLES = frozenset(
    {
        "gp_latest",
        "gp_history",
        "group_members",
        "fetch_log",
        "stations",
        "sensor_presets",
        "custom_elements",
        "custom_states",
        "custom_ephemerides",
    }
)


@dataclass(frozen=True)
class ProbeResult:
    """What ``probe_store`` found at a URL, without changing anything there."""

    backend: str
    #: Local file behind the URL, for file-based backends.
    path: Path | None
    #: The database already exists (for SQLite: the file does).
    exists: bool
    #: It already holds a SODA schema; a new or empty database gets one on first open.
    initialized: bool
    #: SODA could open it for writing on the next start.
    writable: bool
    #: Why ``writable`` is false, in English for logs; empty when it is true.
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.writable


def sqlite_path(url: str) -> Path:
    """File path of a ``sqlite:///<path>`` URL.

    Raises:
        ValueError: The URL is not a SQLite URL with a path.
    """
    scheme, sep, rest = url.partition("://")
    if scheme == "sqlite" and sep and rest.startswith("/") and len(rest) > 1:
        return Path(rest[1:])
    supported = ", ".join(f"{name}:///<path>" for name in SUPPORTED_SCHEMES)
    raise ValueError(f"Unsupported database URL {url!r}; expected one of: {supported}")


def open_store(url: str) -> Store:
    """Open the backend a database URL names.

    Args:
        url: ``sqlite:///<path>``. The path may be relative (``sqlite:///data/soda.db``) or
            absolute (``sqlite:////var/lib/soda.db``), following the SQLAlchemy convention.

    Returns:
        A ready store; the schema is created or migrated on open.

    Raises:
        ValueError: The scheme is not one of ``SUPPORTED_SCHEMES``.
    """
    path = sqlite_path(url)
    from .sqlite_store import SqliteStore

    return SqliteStore(path)


def probe_store(url: str) -> ProbeResult:
    """Check whether SODA could use a database URL, without creating or migrating anything.

    ``open_store`` builds the schema as a side effect, which is wrong for a "test the
    connection" button. An existing SQLite file is opened read-only to look at its tables;
    a missing one only needs a writable directory to be created on the next start.

    Args:
        url: A URL ``open_store`` would accept.

    Returns:
        What was found. ``ok`` is false when the next start would fail to open it.

    Raises:
        ValueError: The URL is not one ``open_store`` understands.
    """
    path = sqlite_path(url)
    from .sqlite_store import probe_sqlite

    return probe_sqlite(path)
