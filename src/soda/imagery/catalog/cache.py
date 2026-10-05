"""Catalogue documents kept on disk, so a search does not refetch what rarely changes."""

import hashlib
import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ...named_files import write_atomic

logger = logging.getLogger(__name__)


class JsonCache:
    """JSON values by key, each with the time it was stored."""

    def __init__(self, root: Path, clock: Callable[[], float] = time.time) -> None:
        self.root = root
        self._clock = clock

    def _path(self, key: str) -> Path:
        return self.root / f"{hashlib.sha256(key.encode()).hexdigest()[:32]}.json"

    def get(self, key: str, ttl_s: float | None) -> Any | None:
        """The stored value, or ``None`` when there is none or it is older than ``ttl_s``.

        Args:
            key: What the value was stored under.
            ttl_s: Longest acceptable age in seconds; ``None`` accepts any age.
        """
        try:
            stored = json.loads(self._path(key).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(stored, dict) or stored.get("key") != key:
            return None
        if ttl_s is not None and self._clock() - float(stored.get("at", 0)) > ttl_s:
            return None
        return stored.get("value")

    def put(self, key: str, value: Any) -> None:
        """Store a value; a failure to write only costs the next lookup a request."""
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            payload = json.dumps({"key": key, "at": self._clock(), "value": value})
            write_atomic(self._path(key), payload.encode())
        except OSError as error:
            logger.warning("Could not cache catalogue data: %s", error)
