"""Imports that take a while, run one at a time off the event loop.

Jobs live in memory only. A set exists once its sidecar is written, so an import cut short by
a restart simply never happened; ``ImageryLibrary.sweep`` removes what it left on disk.
"""

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .formats import ImageryError
from .library import ImageryLibrary

logger = logging.getLogger(__name__)


class Report(Protocol):
    """Progress callback handed to a job; raises to cancel it."""

    def __call__(self, fraction: float, stage: str = "tiling") -> None: ...


#: Given the MBTiles path to create and a progress callback; returns sidecar fields. Besides
#: the tiling facts it may return any other field, which then replaces the job's own.
Work = Callable[[Path, Report], dict[str, Any]]
#: Told whether the import produced a set, after its scratch files are gone.
Finish = Callable[[bool], None]


class _Cancelled(Exception):
    """Raised inside a worker when its job was dismissed or the server is stopping."""


@dataclass
class ImportJob:
    """An import that is waiting or running, or one that failed and waits to be dismissed."""

    id: str
    #: Sidecar fields known before the import: name, source format, attribution and times.
    meta: dict[str, Any]
    status: str = "processing"
    #: What a processing job is doing: ``queued``, ``downloading`` or ``tiling``.
    stage: str = "queued"
    progress: float = 0.0
    error: dict[str, Any] | None = None
    cancelled: bool = field(default=False, repr=False)


class ImageryHub:
    """The imagery library plus the imports in flight."""

    def __init__(self, library: ImageryLibrary) -> None:
        self.library = library
        self._jobs: dict[str, ImportJob] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="imagery-import")
        self._closing = False

    def jobs(self) -> list[ImportJob]:
        """Waiting, running and failed imports, oldest first."""
        with self._lock:
            return list(self._jobs.values())

    def pending_count(self) -> int:
        """Imports waiting or running, for the queue limit."""
        with self._lock:
            return sum(1 for job in self._jobs.values() if job.status == "processing")

    def submit(
        self, set_id: str, meta: dict[str, Any], work: Work, on_finish: Finish | None = None
    ) -> ImportJob:
        """Queue an import.

        Args:
            set_id: Id the set will have.
            meta: Sidecar fields known up front.
            work: Does the import; runs on the worker thread.
            on_finish: Called on the worker thread once the import is over, whatever the outcome.
        """
        job = ImportJob(set_id, meta)
        with self._lock:
            self._jobs[set_id] = job
        self._executor.submit(self._run, job, work, on_finish)
        return job

    def fail(self, set_id: str, meta: dict[str, Any], error: ImageryError) -> ImportJob:
        """List an import that could not even start, so its reason can be read and dismissed."""
        job = ImportJob(set_id, meta, status="failed", error=error.as_message())
        with self._lock:
            self._jobs[set_id] = job
        return job

    def dismiss(self, set_id: str) -> bool:
        """Cancel a waiting or running import, or clear a failed one.

        Returns:
            Whether there was such a job.
        """
        with self._lock:
            job = self._jobs.get(set_id)
            if job is None:
                return False
            job.cancelled = True
            if job.status == "failed":
                del self._jobs[set_id]
        return True

    def shutdown(self) -> None:
        """Stop accepting work and make the running import give up at its next step."""
        self._closing = True
        self._executor.shutdown(wait=False, cancel_futures=True)

    def _run(self, job: ImportJob, work: Work, on_finish: Finish | None) -> None:
        def report(fraction: float, stage: str = "tiling") -> None:
            if job.cancelled or self._closing:
                raise _Cancelled
            job.progress, job.stage = fraction, stage

        target = self.library.work_dir(job.id) / "tiles.mbtiles"
        error: dict[str, Any] | None = None
        created = False
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Only a cancel check: the work names its own first stage.
            report(0.0, job.stage)
            facts = work(target, report)
            report(1.0)
            self.library.add(job.id, target, {**job.meta, **facts})
            created = True
        except _Cancelled:
            pass
        except ImageryError as failure:
            error = failure.as_message()
        except Exception:
            logger.exception("Imagery import %s failed", job.id)
            error = ImageryError(
                "imageryImportFailed", "영상 변환 실패 · 서버 로그 확인 필요"
            ).as_message()
        finally:
            self.library.discard_work(job.id)
        if on_finish is not None:
            try:
                on_finish(created)
            except Exception:
                logger.exception("Imagery import %s could not tidy up", job.id)
        with self._lock:
            if error is None or job.cancelled:
                self._jobs.pop(job.id, None)
            else:
                job.status, job.error = "failed", error
