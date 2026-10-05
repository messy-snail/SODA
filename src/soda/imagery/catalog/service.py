"""One front for the catalogues: search a box, and fetch an item into a job's scratch file."""

import time
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

import httpx

from ..jobs import Report
from ..limits import MAX_CATALOG_RESULTS, MAX_IMAGERY_BYTES
from . import Resolved, maxar, oam
from .cache import JsonCache
from .http import CatalogHttp

_MODULES: dict[str, ModuleType] = {"maxar": maxar, "oam": oam}
Box = tuple[float, float, float, float]


class CatalogService:
    """Searches and downloads against the allow-listed catalogues, with a disk cache."""

    def __init__(
        self, client: httpx.Client, cache_dir: Path, clock: Callable[[], float] = time.time
    ) -> None:
        self._http = CatalogHttp(client)
        self._cache = JsonCache(cache_dir, clock)

    def search(self, source: str, box: Box) -> dict[str, Any]:
        """Items of one catalogue whose footprint touches the box.

        Raises:
            ImageryError: ``imageryCatalogUnavailable`` when the catalogue cannot be reached.
        """
        found = _MODULES[source].search(self._http, self._cache, box)
        return {
            "source": source,
            "found": len(found),
            "truncated": len(found) >= MAX_CATALOG_RESULTS,
            "results": [candidate.as_dict() for candidate in found[:MAX_CATALOG_RESULTS]],
        }

    def check_id(self, source: str, item_id: str) -> None:
        """Raise ``imageryCatalogItemUnknown`` unless the id has the source's shape."""
        _MODULES[source].check_id(item_id)

    def provisional_name(self, source: str, item_id: str) -> str:
        """A name for the import while the catalogue has not been asked yet."""
        return _MODULES[source].provisional_name(item_id)

    def fetch(self, source: str, item_id: str, target: Path, report: Report) -> Resolved:
        """Look an item up, download its image, and return what to record about it.

        Raises:
            ImageryError: When the item is unknown, the catalogue or the download fails, the
                host is not allowed, or the file is too large.
        """
        resolved = _MODULES[source].resolve(self._http, self._cache, item_id)
        report(0.0, "downloading")
        self._http.download(source, resolved.url, target, MAX_IMAGERY_BYTES, report)
        return resolved
