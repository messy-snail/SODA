"""GP data access with CelesTrak request budgeting and optional Space-Track history."""

import asyncio
import hashlib
import json
import logging
import random
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from ..errors import CodedError, message
from .celestrak import CelesTrakClient, FetchResult
from .models import ElementSet, InvalidOmm, normalize_omm
from .spacetrack import SpaceTrackClient, SpaceTrackError
from .store import FetchRecord, Store

logger = logging.getLogger(__name__)

REFRESH_INTERVAL = timedelta(hours=2)
FRESHNESS_MARGIN = timedelta(minutes=15)
ERROR_BACKOFF = timedelta(minutes=2)
HISTORY_THRESHOLD = timedelta(days=3)
HISTORY_RETRY = timedelta(hours=1)


class ElementsUnavailable(CodedError, LookupError):
    """No element set is cached and none may be fetched right now."""


@dataclass(frozen=True)
class ResolvedElements:
    elements: ElementSet
    warnings: list[str]


def parse_records(records: Iterable[dict[str, Any]], source: str) -> list[ElementSet]:
    elements, skipped = [], 0
    for record in records:
        try:
            elements.append(normalize_omm(record, source))
        except InvalidOmm:
            skipped += 1
    if skipped:
        logger.warning("Skipped %d invalid %s records", skipped, source)
    return elements


def next_allowed(record: FetchRecord | None) -> datetime | None:
    """Earliest time the same upstream request may be repeated."""
    if record is None:
        return None
    if record.consecutive_errors:
        wait = min(REFRESH_INTERVAL, ERROR_BACKOFF * 2 ** (record.consecutive_errors - 1))
    else:
        wait = REFRESH_INTERVAL
    return record.last_attempt_at + wait


class GPService:
    def __init__(
        self,
        store: Store,
        celestrak: CelesTrakClient,
        spacetrack: SpaceTrackClient | None = None,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.store = store
        self._celestrak = celestrak
        self._spacetrack = spacetrack
        self._clock = clock
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._bulk: dict[str, tuple[bytes, str]] = {}

    @property
    def spacetrack_enabled(self) -> bool:
        return self._spacetrack is not None

    def can_fetch(self, key: str) -> bool:
        allowed = next_allowed(self.store.fetch_record("celestrak", key))
        return allowed is None or self._clock() >= allowed

    def _record(self, key: str, result: FetchResult, count: int | None = None) -> None:
        self.store.record_fetch(
            "celestrak",
            key,
            at=self._clock(),
            status=result.status,
            ok=result.status != "error",
            detail=result.detail,
            object_count=count,
        )

    async def refresh_group(self, group: str) -> str:
        """Download one CelesTrak group unless the 2-hour budget forbids it.

        Returns:
            ``skipped`` or the upstream fetch status.
        """
        key = f"group:{group}"
        async with self._locks[key]:
            if not self.can_fetch(key):
                return "skipped"
            result = await self._celestrak.fetch_group(group)
            count = None
            if result.status == "ok":
                elements = parse_records(result.records, "celestrak")
                await asyncio.to_thread(self.store.upsert_latest, elements, self._clock())
                await asyncio.to_thread(
                    self.store.replace_group, group, [e.norad_id for e in elements]
                )
                self._bulk.pop(group, None)
                count = len(elements)
            self._record(key, result, count)
            return result.status

    def _is_fresh(self, norad_id: int) -> bool:
        cutoff = self._clock() - REFRESH_INTERVAL - FRESHNESS_MARGIN
        keys = [f"group:{group}" for group in self.store.groups_of(norad_id)]
        keys.append(f"catnr:{norad_id}")
        for key in keys:
            record = self.store.fetch_record("celestrak", key)
            if record and record.last_ok_at and record.last_ok_at >= cutoff:
                return True
        return False

    async def latest(self, norad_id: int) -> ElementSet:
        """Return the newest element set, fetching by catalog number when stale or missing.

        Raises:
            ElementsUnavailable: Nothing cached and CelesTrak may not be queried yet.
        """
        cached = self.store.latest(norad_id)
        if cached and self._is_fresh(norad_id):
            return cached
        key = f"catnr:{norad_id}"
        async with self._locks[key]:
            if self.can_fetch(key) and not self._is_fresh(norad_id):
                result = await self._celestrak.fetch_catnr(norad_id)
                elements = parse_records(result.records, "celestrak")
                if elements:
                    self.store.upsert_latest(elements, self._clock())
                self._record(key, result, len(elements))
            cached = self.store.latest(norad_id)
        if cached is None:
            raise ElementsUnavailable(
                "elementsNotFound",
                f"NORAD {norad_id} 궤도요소 없음",
                norad_id=norad_id,
            )
        return cached

    async def resolve(self, norad_id: int, at: datetime) -> ResolvedElements:
        """Pick the element set best suited to propagate from ``at``."""
        latest = await self.latest(norad_id)
        if at >= latest.epoch - HISTORY_THRESHOLD:
            return ResolvedElements(latest, [])
        if self._spacetrack is None:
            return ResolvedElements(
                latest,
                [
                    message(
                        "historyNeedsSpaceTrack",
                        "시작 시각이 최신 궤도요소 epoch보다 3일 이상 과거 · "
                        "Space-Track 계정을 설정하면 해당 시점의 궤도요소 사용",
                    )
                ],
            )
        historical = await self._history(norad_id, at)
        if historical is None:
            return ResolvedElements(
                latest,
                [
                    message(
                        "historyNotFound",
                        "Space-Track에서 해당 시점 궤도요소를 찾지 못해 최신 요소 사용",
                    )
                ],
            )
        return ResolvedElements(historical, [])

    async def _history(self, norad_id: int, at: datetime) -> ElementSet | None:
        assert self._spacetrack is not None
        start, end = at - HISTORY_THRESHOLD, at + timedelta(days=1)
        candidates = self.store.history_near(norad_id, start, end)
        key = f"history:{norad_id}:{at.date().isoformat()}"
        record = self.store.fetch_record("spacetrack", key)
        recently_tried = record and self._clock() - record.last_attempt_at < HISTORY_RETRY
        if not candidates and not recently_tried:
            try:
                raw = await self._spacetrack.gp_history(norad_id, start, end)
            except SpaceTrackError as error:
                logger.warning("Space-Track history failed: %s", error)
                self.store.record_fetch(
                    "spacetrack", key, at=self._clock(), status="error", ok=False, detail=str(error)
                )
                return None
            candidates = parse_records(raw, "space-track")
            self.store.add_history(candidates)
            self.store.record_fetch(
                "spacetrack",
                key,
                at=self._clock(),
                status="ok",
                ok=True,
                object_count=len(candidates),
            )
        if not candidates:
            return None
        before = [e for e in candidates if e.epoch <= at]
        if before:
            return max(before, key=lambda e: e.epoch)
        return min(candidates, key=lambda e: abs(e.epoch - at))

    def group_payload(self, group: str) -> tuple[bytes, str]:
        """Serialized OMM list for one group and its content ETag."""
        cached = self._bulk.get(group)
        if cached:
            return cached
        elements = self.store.group_elements(group)
        body = json.dumps([e.omm for e in elements], separators=(",", ":")).encode()
        etag = f'"{hashlib.sha1(body).hexdigest()[:20]}"'
        self._bulk[group] = (body, etag)
        return body, etag

    def status(self) -> dict[str, Any]:
        fetches = []
        for record in self.store.fetch_records():
            if record.key.startswith("history:"):
                continue
            allowed = next_allowed(record) if record.source == "celestrak" else None
            fetches.append(
                {
                    "source": record.source,
                    "key": record.key,
                    "last_attempt_at": record.last_attempt_at,
                    "last_ok_at": record.last_ok_at,
                    "last_status": record.last_status,
                    "detail": record.detail,
                    "consecutive_errors": record.consecutive_errors,
                    "object_count": record.object_count,
                    "next_allowed_at": allowed,
                }
            )
        return {
            "objects": self.store.count_latest(),
            "spacetrack_enabled": self.spacetrack_enabled,
            "fetches": fetches,
        }

    async def refresh_forever(self, groups: Iterable[str]) -> None:
        """Background loop refreshing groups as soon as the budget allows."""
        groups = list(groups)
        while True:
            for group in groups:
                try:
                    await self.refresh_group(group)
                except Exception:
                    logger.exception("Refreshing CelesTrak group %s failed", group)
            upcoming = [
                allowed
                for group in groups
                if (allowed := next_allowed(self.store.fetch_record("celestrak", f"group:{group}")))
            ]
            delay = (min(upcoming) - self._clock()).total_seconds() if upcoming else 60.0
            await asyncio.sleep(max(60.0, delay) + random.uniform(5, 120))
