"""Imagery sets on disk: one ``<id>.mbtiles`` with a ``<id>.json`` sidecar describing it.

The sidecar is written last, so a set exists once its sidecar does and a crash mid-import
leaves nothing that looks usable.

There are two directories. The writable one holds what the user put there. The optional
second one holds samples (the ``samples`` git submodule); it is only ever read, its sets are
listed after the user's, and they can be neither edited nor deleted.
"""

import contextlib
import json
import logging
import math
import os
import re
import secrets
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..named_files import write_atomic
from .tiling import resolution_m

logger = logging.getLogger(__name__)

ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
SOURCE_FORMATS = ("mbtiles", "image", "geotiff", "scene")
#: What kind of instrument took a set: a camera, or a synthetic aperture radar.
SENSORS = ("optical", "sar")
_TILES = ".mbtiles"
_SIDECAR = ".json"
_WORK = ".work"


def is_valid_id(set_id: str) -> bool:
    """Whether ``set_id`` may name a set; anything else could escape the directory."""
    return ID_PATTERN.fullmatch(set_id) is not None


@dataclass(frozen=True)
class ImagerySet:
    """One set of tiles and what the globe needs to place it."""

    id: str
    name: str
    source_format: str
    west_deg: float
    south_deg: float
    east_deg: float
    north_deg: float
    #: Flat ``[lon0, lat0, ...]`` outline when it is tighter than the box, else ``None``.
    footprint: tuple[float, ...] | None
    min_zoom: int
    max_zoom: int
    tile_format: str
    tile_count: int
    attribution: str
    #: Licence name as the source states it, such as ``CC BY-NC 4.0``; empty when unknown.
    license: str
    #: Where the set came from when SODA fetched it itself: ``<source>:<item id>``.
    origin: str | None
    acquired_at: str | None
    created_at: str
    #: Ground size of a pixel in metres: what the import measured or the source stated, else
    #: the size of a pixel of the deepest tile level.
    gsd_m: float
    #: One of ``SENSORS``, or ``None`` when nobody said.
    sensor: str | None
    #: ``{"ko": ..., "en": ...}`` names of a sample; a user's set has only ``name``.
    label: dict[str, str] | None
    #: From the read-only samples directory.
    sample: bool
    path: Path
    size_bytes: int
    updated_at: datetime


def _label(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    names = {key: raw.get(key) for key in ("ko", "en")}
    return names if all(isinstance(name, str) and name for name in names.values()) else None


def _gsd_m(raw: dict[str, Any]) -> float:
    stated = raw.get("gsd_m")
    if isinstance(stated, int | float) and not isinstance(stated, bool) and stated > 0:
        return float(stated)
    middle = math.radians((float(raw["south_deg"]) + float(raw["north_deg"])) / 2)
    return round(resolution_m(int(raw["max_zoom"])) * math.cos(middle), 3)


def _read(set_id: str, root: Path, *, sample: bool = False) -> ImagerySet | None:
    tiles, sidecar = root / f"{set_id}{_TILES}", root / f"{set_id}{_SIDECAR}"
    try:
        raw = json.loads(sidecar.read_text(encoding="utf-8"))
        tiles_stat, sidecar_stat = tiles.stat(), sidecar.stat()
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as error:
        logger.warning("Ignoring unreadable imagery sidecar %s: %s", sidecar, error)
        return None
    try:
        footprint = raw.get("footprint")
        return ImagerySet(
            id=set_id,
            name=str(raw["name"]),
            source_format=str(raw["source_format"]),
            west_deg=float(raw["west_deg"]),
            south_deg=float(raw["south_deg"]),
            east_deg=float(raw["east_deg"]),
            north_deg=float(raw["north_deg"]),
            footprint=None if footprint is None else tuple(float(v) for v in footprint),
            min_zoom=int(raw["min_zoom"]),
            max_zoom=int(raw["max_zoom"]),
            tile_format=str(raw["tile_format"]),
            tile_count=int(raw["tile_count"]),
            attribution=str(raw.get("attribution") or ""),
            license=str(raw.get("license") or ""),
            origin=raw.get("origin") or None,
            acquired_at=raw.get("acquired_at") or None,
            created_at=str(raw["created_at"]),
            gsd_m=_gsd_m(raw),
            sensor=raw.get("sensor") if raw.get("sensor") in SENSORS else None,
            label=_label(raw.get("label")),
            sample=sample,
            path=tiles,
            size_bytes=tiles_stat.st_size,
            updated_at=datetime.fromtimestamp(max(tiles_stat.st_mtime, sidecar_stat.st_mtime), UTC),
        )
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        logger.warning("Ignoring invalid imagery sidecar %s: %s", sidecar, error)
        return None


def _ids_in(root: Path | None) -> set[str]:
    if root is None or not root.is_dir():
        return set()
    return {p.stem for p in root.glob(f"*{_SIDECAR}") if is_valid_id(p.stem)}


class ImageryLibrary:
    """The sets in one writable directory, plus the samples in a read-only one."""

    def __init__(self, root: Path, samples_root: Path | None = None) -> None:
        self.root = root
        #: ``None`` when samples are switched off.
        self.samples_root = samples_root

    def new_id(self) -> str:
        """A fresh id. Ids are never reused, so a tile URL can be cached for good."""
        while True:
            set_id = "u" + secrets.token_hex(6)
            if self.get(set_id) is None and not self.work_dir(set_id).exists():
                return set_id

    def work_dir(self, set_id: str) -> Path:
        """Scratch directory for an import in progress.

        Raises:
            ValueError: If the id could escape the directory.
        """
        if not is_valid_id(set_id):
            raise ValueError(f"invalid imagery id: {set_id!r}")
        return self.root / _WORK / set_id

    def get(self, set_id: str) -> ImagerySet | None:
        """The user's set with this id, else the sample, else ``None``."""
        if not is_valid_id(set_id):
            return None
        found = _read(set_id, self.root)
        if found is None and self.samples_root is not None:
            found = _read(set_id, self.samples_root, sample=True)
        return found

    def _ids(self) -> set[str]:
        return _ids_in(self.root)

    def entries(self) -> list[ImagerySet]:
        """The user's sets, newest first, then the samples: optical before radar, by name."""
        own = self._ids()
        sets = [found for found in map(self.get, own) if found is not None]
        sets.sort(key=lambda item: item.created_at, reverse=True)
        return sets + self.samples(own)

    def samples(self, hidden: set[str] | None = None) -> list[ImagerySet]:
        """The samples a user's set of the same id does not stand in front of.

        They come grouped by sensor, in the order of ``SENSORS``, and by name within a group.
        """
        if self.samples_root is None:
            return []
        ids = _ids_in(self.samples_root) - (self._ids() if hidden is None else hidden)
        found = [_read(set_id, self.samples_root, sample=True) for set_id in ids]

        def order(item: ImagerySet) -> tuple[int, str]:
            group = SENSORS.index(item.sensor) if item.sensor in SENSORS else len(SENSORS)
            return group, item.name

        return sorted((item for item in found if item is not None), key=order)

    def count(self) -> int:
        """How many sets the user has, for the set limit. Samples are not counted."""
        return len(self._ids())

    def add(self, set_id: str, tiles: Path, meta: dict[str, Any]) -> ImagerySet:
        """Move finished tiles into place and write the sidecar that makes the set exist."""
        self.root.mkdir(parents=True, exist_ok=True)
        os.replace(tiles, self.root / f"{set_id}{_TILES}")
        self._write_sidecar(set_id, meta)
        created = self.get(set_id)
        assert created is not None
        return created

    def _write_sidecar(self, set_id: str, meta: dict[str, Any]) -> None:
        payload = json.dumps(meta, indent=2, ensure_ascii=False).encode()
        write_atomic(self.root / f"{set_id}{_SIDECAR}", payload)

    def update(self, set_id: str, **changes: Any) -> ImagerySet | None:
        """Rewrite the editable fields of a set; ``None`` when it does not exist."""
        sidecar = self.root / f"{set_id}{_SIDECAR}"
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return None
        self._write_sidecar(set_id, {**meta, **changes})
        return self.get(set_id)

    def delete(self, set_id: str) -> bool:
        """Remove a set.

        Returns:
            Whether the set existed.
        """
        sidecar = self.root / f"{set_id}{_SIDECAR}"
        if not sidecar.is_file():
            return False
        # Tiles first: if they are locked (Windows, a tile being read) nothing has changed yet
        # and the caller can retry.
        with contextlib.suppress(FileNotFoundError):
            (self.root / f"{set_id}{_TILES}").unlink()
        with contextlib.suppress(FileNotFoundError):
            sidecar.unlink()
        return True

    def discard_work(self, set_id: str) -> None:
        """Remove the scratch directory of an import, finished or not."""
        shutil.rmtree(self.work_dir(set_id), ignore_errors=True)

    def sweep(self) -> None:
        """Remove what an interrupted import or delete left behind: scratch files, and tiles
        or sidecars whose other half is missing."""
        shutil.rmtree(self.root / _WORK, ignore_errors=True)
        if not self.root.is_dir():
            return
        for pattern, other in ((f"*{_TILES}", _SIDECAR), (f"*{_SIDECAR}", _TILES)):
            for path in self.root.glob(pattern):
                if not path.with_suffix(other).is_file():
                    logger.info("Removing half of an imagery set: %s", path.name)
                    with contextlib.suppress(OSError):
                        path.unlink()
