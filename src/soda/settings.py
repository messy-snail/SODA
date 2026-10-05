"""Local settings. Credentials come from settings.local.toml or environment variables."""

import json
import os
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_LOCAL_SETTINGS = Path("settings.local.toml")
#: Where the ``samples`` submodule keeps its imagery, beside ``src`` in a checkout.
SAMPLES_DIR = Path(__file__).resolve().parents[2] / "samples" / "imagery"


@dataclass(frozen=True)
class SpaceTrackSettings:
    username: str = ""
    password: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.username and self.password)


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path("data")
    #: ``soda serve`` address. ``SODA_BIND``/``SODA_PORT`` override TOML; CLI flags override both.
    bind: str = "127.0.0.1"
    port: int = 1992
    celestrak_url: str = "https://celestrak.org/NORAD/elements/gp.php"
    auto_refresh: bool = True
    refresh_groups: tuple[str, ...] = ("active",)
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    spacetrack: SpaceTrackSettings = field(default_factory=SpaceTrackSettings)
    #: Storage backend URL; empty means ``sqlite:///<data_dir>/soda.db``. See ``gp.store``.
    database_url: str = ""
    #: Logos shipped with the package, shadowed by uploads in ``logos_dir``. Not read from
    #: TOML or the environment; tests override it with ``dataclasses.replace``.
    builtin_logos_dir: Path = Path(__file__).parent / "assets" / "logos"
    #: Import files dropped into ``<data_dir>/imagery/inbox``. TOML ``imagery_inbox``.
    imagery_inbox: bool = True
    #: Folder of read-only sample imagery, or ``None`` for none. ``read`` points it at the
    #: ``samples`` submodule unless TOML ``imagery_samples`` is false; a bare ``Settings()``,
    #: as the tests build, has no samples.
    imagery_samples_dir: Path | None = None
    #: TOML file these settings came from, and where the settings screen writes changes.
    #: ``None`` when no file was read; the screen then creates ``settings.local.toml``.
    source_path: Path | None = None
    #: Where ``database_url`` came from: ``"env"``, ``"toml"`` or ``"default"``.
    database_source: str = "default"

    @property
    def resolved_database_url(self) -> str:
        return self.database_url or f"sqlite:///{(self.data_dir / 'soda.db').as_posix()}"

    @property
    def ephemeris_dir(self) -> Path:
        return self.data_dir / "ephemeris"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    @property
    def logos_dir(self) -> Path:
        return self.data_dir / "logos"

    @property
    def imagery_dir(self) -> Path:
        return self.data_dir / "imagery"

    @classmethod
    def read(cls, path: Path | None = None) -> "Settings":
        """Load settings from TOML, then apply ``SODA_*`` environment overrides.

        Args:
            path: TOML file. Defaults to ``$SODA_SETTINGS``, then ``settings.local.toml``.

        Returns:
            Resolved settings.
        """
        if path is None and os.environ.get("SODA_SETTINGS"):
            path = Path(os.environ["SODA_SETTINGS"])
        if path is None and DEFAULT_LOCAL_SETTINGS.is_file():
            path = DEFAULT_LOCAL_SETTINGS
        raw: dict = {}
        if path is not None:
            with path.open("rb") as source:
                raw = tomllib.load(source)
        defaults = cls()
        spacetrack_raw = raw.get("spacetrack", {})
        spacetrack = SpaceTrackSettings(
            username=os.environ.get("SODA_SPACETRACK_USERNAME", spacetrack_raw.get("username", "")),
            password=os.environ.get("SODA_SPACETRACK_PASSWORD", spacetrack_raw.get("password", "")),
        )
        return cls(
            data_dir=Path(os.environ.get("SODA_DATA_DIR", raw.get("data_dir", defaults.data_dir))),
            bind=os.environ.get("SODA_BIND", raw.get("bind", defaults.bind)),
            port=int(os.environ.get("SODA_PORT", raw.get("port", defaults.port))),
            celestrak_url=raw.get("celestrak_url", defaults.celestrak_url),
            auto_refresh=raw.get("auto_refresh", defaults.auto_refresh),
            refresh_groups=tuple(raw.get("refresh_groups", defaults.refresh_groups)),
            cors_origins=tuple(raw.get("cors_origins", defaults.cors_origins)),
            imagery_inbox=bool(raw.get("imagery_inbox", defaults.imagery_inbox)),
            imagery_samples_dir=SAMPLES_DIR if raw.get("imagery_samples", True) else None,
            spacetrack=spacetrack,
            database_url=os.environ.get("SODA_DATABASE_URL", raw.get("database_url", "")),
            source_path=path,
            database_source=(
                "env"
                if "SODA_DATABASE_URL" in os.environ
                else "toml"
                if raw.get("database_url")
                else "default"
            ),
        )

    @property
    def writable_path(self) -> Path:
        """File the settings screen saves to."""
        return self.source_path or DEFAULT_LOCAL_SETTINGS


_TABLE_HEADER = re.compile(r"^\s*\[")


def write_local_setting(path: Path, key: str, value: str) -> None:
    """Set one top-level string key in a TOML file, leaving every other line as it was.

    A full TOML rewrite would drop the user's comments, so only the ``key = ...`` line
    changes: it is replaced where it already sits at the top level, or inserted before the
    first ``[table]`` (top-level keys must come first). An empty ``value`` removes the key.

    Args:
        path: TOML file; created when missing.
        key: Bare top-level key, such as ``database_url``.
        value: New string value.
    """
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    assignment = re.compile(rf"^\s*{re.escape(key)}\s*=")
    # JSON string escaping is valid TOML basic-string escaping.
    line = f"{key} = {json.dumps(value, ensure_ascii=False)}"
    first_table = next((i for i, text in enumerate(lines) if _TABLE_HEADER.match(text)), len(lines))
    existing = next((i for i in range(first_table) if assignment.match(lines[i])), None)
    if existing is not None:
        if value:
            lines[existing] = line
        else:
            del lines[existing]
    elif value:
        at = first_table
        # Keep a blank line between the new key and a table header that follows it.
        lines[at:at] = [line, ""] if at < len(lines) else [line]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
