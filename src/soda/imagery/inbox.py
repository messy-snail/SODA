"""A watched folder: files dropped into ``data/imagery/inbox`` are imported on their own.

This is the way in for files too large or too many for a browser upload. The server still
never takes a path from a client: it only looks in this one folder under its own data
directory.

A file is claimed by moving it to ``inbox/.processing/<id>/`` (not ``.work``, which a restart
wipes), imported, and then moved to ``inbox/done/`` or ``inbox/failed/``. Nothing the user
put here is ever deleted.

A scene product (see ``products``) comes as a ``.zip`` or as the folder it unpacks to, and is
claimed and put away whole, the same way.
"""

import json
import logging
import os
import shutil
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import mbtiles, products, warp
from .formats import ImageryError
from .jobs import ImageryHub, Report
from .library import SENSORS
from .limits import (
    MAX_ATTRIBUTION_LENGTH,
    MAX_IMAGERY_SETS,
    MAX_IMPORT_QUEUE,
    MAX_INBOX_BYTES,
    MAX_LICENSE_LENGTH,
    MAX_NAME_LENGTH,
)
from .tiling import check_corners

logger = logging.getLogger(__name__)

#: Seconds a file must sit unchanged before it is taken; a copy in progress keeps changing.
SETTLE_S = 10.0
_FORMATS = {
    ".mbtiles": "mbtiles",
    ".tif": "geotiff",
    ".tiff": "geotiff",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".zip": "scene",
}
#: Folders of the inbox's own; a product folder cannot have these names.
_OWN_FOLDERS = {"done", "failed"}
#: Files an import writes into its claim; a restart does not hand them back to the user.
_SCRATCH = {"georeferenced.tif", products.EXTRACTED_NAME}
_SIDECAR_BYTES = 64 * 1024
_STAMP = "%Y-%m-%dT%H:%M:%S.%f"


def _now() -> str:
    return datetime.now(UTC).strftime(_STAMP)[:-3] + "Z"


def _free_path(directory: Path, name: str) -> Path:
    """``directory/name``, or the first ``name-1``, ``name-2`` ... that is not taken."""
    candidate = directory / name
    stem, suffix = candidate.stem, candidate.suffix
    counter = 0
    while candidate.exists():
        counter += 1
        candidate = directory / f"{stem}-{counter}{suffix}"
    return candidate


def _sidecar_invalid() -> ImageryError:
    return ImageryError(
        "imagerySidecarInvalid",
        "inbox의 .json 설명 파일 확인 필요 · corners_deg는 경도·위도 8개 값",
    )


def read_sidecar(path: Path) -> dict[str, Any]:
    """The optional ``<stem>.json`` beside an inbox file, checked field by field.

    Returns:
        Any of ``corners_deg``, ``name``, ``attribution``, ``license``, ``sensor`` and
        ``acquired_at``.

    Raises:
        ImageryError: ``imagerySidecarInvalid`` when the file is not that.
    """
    try:
        if path.stat().st_size > _SIDECAR_BYTES:
            raise _sidecar_invalid()
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise _sidecar_invalid() from error
    if not isinstance(raw, dict):
        raise _sidecar_invalid()
    clean: dict[str, Any] = {}
    limits = {
        "name": MAX_NAME_LENGTH,
        "attribution": MAX_ATTRIBUTION_LENGTH,
        "license": MAX_LICENSE_LENGTH,
    }
    for key, limit in limits.items():
        value = raw.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > limit:
            raise _sidecar_invalid()
        clean[key] = value.strip()
    sensor = raw.get("sensor")
    if sensor is not None:
        if sensor not in SENSORS:
            raise _sidecar_invalid()
        clean["sensor"] = sensor
    corners = raw.get("corners_deg")
    if corners is not None:
        numeric = isinstance(corners, list) and all(
            isinstance(value, int | float) and not isinstance(value, bool) for value in corners
        )
        if not numeric:
            raise _sidecar_invalid()
        try:
            check_corners(tuple(float(value) for value in corners))
        except ImageryError as error:
            raise _sidecar_invalid() from error
        clean["corners_deg"] = tuple(float(value) for value in corners)
    acquired = raw.get("acquired_at")
    if acquired is not None:
        try:
            moment = datetime.fromisoformat(str(acquired).replace("Z", "+00:00"))
        except ValueError as error:
            raise _sidecar_invalid() from error
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=UTC)
        clean["acquired_at"] = moment.astimezone(UTC).strftime(_STAMP)[:-3] + "Z"
    return clean


class InboxWatcher:
    """Scans the inbox and feeds what has settled there to the import queue."""

    def __init__(
        self, hub: ImageryHub, root: Path, *, clock: Callable[[], float] = time.time
    ) -> None:
        self.hub = hub
        self.root = root
        self._clock = clock
        #: ``(size, mtime_ns)`` of each candidate at the previous scan.
        self._seen: dict[str, tuple[int, int]] = {}
        #: Files still in the inbox after the last scan, with the reason each one waits.
        self.waiting: list[dict[str, str]] = []

    @property
    def _processing(self) -> Path:
        return self.root / ".processing"

    def recover(self) -> None:
        """Create the folder, and put back what a previous run had claimed but not finished."""
        self.root.mkdir(parents=True, exist_ok=True)
        if not self._processing.is_dir():
            return
        for claimed in self._processing.iterdir():
            for item in claimed.iterdir() if claimed.is_dir() else ():
                if item.name not in _SCRATCH:
                    os.replace(item, _free_path(self.root, item.name))
            shutil.rmtree(claimed, ignore_errors=True)

    def _candidates(self) -> list[tuple[Path, str]]:
        """Files with a known extension, and folders that hold a scene's metadata."""
        found = []
        for path in sorted(self.root.iterdir()):
            if path.name.startswith(".") or path.is_symlink():
                continue
            if path.is_file() and path.suffix.lower() in _FORMATS:
                found.append((path, _FORMATS[path.suffix.lower()]))
            elif path.is_dir() and path.name not in _OWN_FOLDERS and products.metadata_files(path):
                found.append((path, "scene"))
        return found

    def _settled(self, path: Path) -> bool:
        if path.is_dir():
            state = products.folder_state(path)
            unchanged = self._seen.get(path.name) == state
            self._seen[path.name] = state
            return unchanged and self._clock() - state[1] / 1e9 >= SETTLE_S
        stat = path.stat()
        state = (stat.st_size, stat.st_mtime_ns)
        unchanged = self._seen.get(path.name) == state
        self._seen[path.name] = state
        if path.suffix.lower() == ".mbtiles" and any(
            path.with_name(path.name + tail).exists() for tail in ("-journal", "-wal")
        ):
            return False
        return unchanged and self._clock() - stat.st_mtime >= SETTLE_S

    def _full(self) -> bool:
        hub = self.hub
        return (
            hub.library.count() + len(hub.jobs()) >= MAX_IMAGERY_SETS
            or hub.pending_count() >= MAX_IMPORT_QUEUE
        )

    def scan_once(self) -> None:
        """Take every file that has settled and has what it needs; note why the rest wait."""
        if not self.root.is_dir():
            self.waiting = []
            return
        waiting: list[dict[str, str]] = []
        candidates = self._candidates()
        self._seen = {
            name: state for name, state in self._seen.items() if (self.root / name).exists()
        }
        for path, source_format in candidates:
            # A folder's name is taken whole: it may well contain dots.
            stem = path.name if path.is_dir() else path.stem
            sidecar = path.with_name(stem + ".json")
            try:
                if not self._settled(path):
                    waiting.append({"file": path.name, "reason": "settling"})
                elif source_format == "image" and not sidecar.is_file():
                    waiting.append({"file": path.name, "reason": "needsCorners"})
                elif self._full():
                    waiting.append({"file": path.name, "reason": "full"})
                else:
                    self._take(path, source_format, sidecar if sidecar.is_file() else None)
            except OSError as error:
                # The file went away or is locked; the next scan looks again.
                logger.info("Inbox file %s skipped: %s", path.name, error)
        self.waiting = waiting

    def _take(self, path: Path, source_format: str, sidecar: Path | None) -> None:
        hub = self.hub
        set_id = hub.library.new_id()
        claimed = self._processing / set_id
        claimed.mkdir(parents=True)
        source = claimed / path.name
        os.replace(path, source)
        moved = [source]
        if sidecar is not None:
            os.replace(sidecar, claimed / sidecar.name)
            moved.append(claimed / sidecar.name)
        self._seen.pop(path.name, None)

        def finish(created: bool) -> None:
            target = self.root / ("done" if created else "failed")
            target.mkdir(exist_ok=True)
            for item in moved:
                if item.exists():
                    os.replace(item, _free_path(target, item.name))
            shutil.rmtree(claimed, ignore_errors=True)

        stem = path.name if source.is_dir() else path.stem
        meta: dict[str, Any] = {
            "name": stem[:MAX_NAME_LENGTH] or path.name[:MAX_NAME_LENGTH],
            "source_format": source_format,
            "attribution": "",
            "license": "",
            "origin": None,
            "acquired_at": None,
            "created_at": _now(),
            "sensor": None,
        }
        try:
            details = read_sidecar(moved[1]) if sidecar is not None else {}
            if source_format == "image" and "corners_deg" not in details:
                raise _sidecar_invalid()
            if not source.is_dir() and source.stat().st_size > MAX_INBOX_BYTES:
                limit = MAX_INBOX_BYTES // (1024 * 1024)
                raise ImageryError(
                    "imageryTooLarge", f"영상 파일은 {limit} MB 이하만 등록 가능", max_mb=limit
                )
            product = products.open_product(source) if source_format == "scene" else None
        except ImageryError as error:
            hub.fail(set_id, meta, error)
            finish(False)
            return
        corners = details.pop("corners_deg", None)
        if product is not None:
            # What the product says about itself; the sidecar, when there is one, has the last
            # word. The licence is not in the product, so it stays empty unless given.
            scene = product.scene
            corners = scene.corners
            meta.update(
                name=scene.name or meta["name"],
                attribution=scene.attribution,
                acquired_at=scene.acquired_at,
                sensor="optical",
            )
        meta.update({key: value for key, value in details.items() if value})
        logger.info("Importing %s from the inbox as %s", path.name, set_id)

        def work(target: Path, report: Report) -> dict[str, Any]:
            if source_format == "geotiff":
                return warp.import_geotiff(source, target, report)
            if source_format == "image":
                return warp.import_image(source, corners, target, report)
            if product is not None:
                image = products.image_file(product, claimed)
                try:
                    return warp.import_scene(
                        image,
                        corners,
                        product.scene.bands,
                        claimed / "georeferenced.tif",
                        target,
                        report,
                        product.scene.locate,
                    )
                finally:
                    if image.parent == claimed:
                        image.unlink(missing_ok=True)
            info = mbtiles.inspect(source)
            # The original stays the user's; the library gets its own copy (a link when it can).
            try:
                os.link(source, target)
            except OSError:
                shutil.copyfile(source, target)
            west_deg, south_deg, east_deg, north_deg = info.bounds_deg
            facts: dict[str, Any] = {
                "west_deg": west_deg,
                "south_deg": south_deg,
                "east_deg": east_deg,
                "north_deg": north_deg,
                "footprint": None,
                "min_zoom": info.min_zoom,
                "max_zoom": info.max_zoom,
                "tile_format": info.tile_format,
                "tile_count": info.tile_count,
            }
            if not meta["attribution"] and info.attribution:
                facts["attribution"] = info.attribution
            return facts

        hub.submit(set_id, meta, work, finish)
