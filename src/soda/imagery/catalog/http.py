"""The only place SODA makes requests to an imagery catalogue.

Every request is https to a host on a short list, without following redirects, with a size
cap enforced while the body streams. A URL comes from catalogue data, never from a client.
"""

import json
import logging
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from ..formats import ImageryError
from ..jobs import Report
from ..limits import MAX_CATALOG_JSON_BYTES

logger = logging.getLogger(__name__)

_S3 = r"\.s3(\.[a-z0-9-]+)?\.amazonaws\.com"
#: Hosts each source may be fetched from. S3 buckets answer on a global and a regional name.
ALLOWED_HOSTS = {
    "maxar": (re.compile(rf"maxar-opendata{_S3}"),),
    "oam": (
        re.compile(r"api\.openaerialmap\.org"),
        re.compile(rf"oin-hotosm(-temp)?{_S3}"),
    ),
}
_JSON_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
_DOWNLOAD_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
#: Seconds a failed address is not asked again, so a search retried at once costs nothing.
_FAILED_FOR_S = 60.0
_CHUNK = 1024 * 1024


def is_allowed(source: str, url: str) -> bool:
    """Whether a URL is plain https to one of the source's hosts."""
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.username or parts.password:
        return False
    try:
        if parts.port is not None:
            return False
    except ValueError:
        return False
    host = parts.hostname or ""
    return any(pattern.fullmatch(host) for pattern in ALLOWED_HOSTS.get(source, ()))


def _unavailable(source: str) -> ImageryError:
    return ImageryError(
        "imageryCatalogUnavailable",
        "영상 카탈로그에 연결할 수 없음 · 잠시 후 다시 시도",
        source=source,
    )


def not_allowed() -> ImageryError:
    return ImageryError("imageryDownloadNotAllowed", "허용되지 않은 주소의 영상은 가져올 수 없음")


def _download_failed() -> ImageryError:
    return ImageryError("imageryDownloadFailed", "영상 파일을 내려받지 못함 · 잠시 후 다시 시도")


class CatalogHttp:
    """JSON lookups and file downloads against the allow-listed catalogue hosts."""

    def __init__(self, client: httpx.Client, clock: Callable[[], float] = time.monotonic) -> None:
        self._client = client
        self._clock = clock
        self._failed: dict[str, float] = {}

    def get_json(self, source: str, url: str) -> Any:
        """Fetch and parse a small JSON document.

        Raises:
            ImageryError: ``imageryCatalogUnavailable`` when the host is not allowed, the
                request fails, the document is too large, or it is not JSON.
        """
        if not is_allowed(source, url) or self._failed.get(url, 0.0) > self._clock():
            raise _unavailable(source)
        try:
            with self._client.stream(
                "GET", url, timeout=_JSON_TIMEOUT, follow_redirects=False
            ) as response:
                if response.status_code != 200:
                    raise httpx.HTTPError(f"status {response.status_code}")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_CATALOG_JSON_BYTES:
                        raise httpx.HTTPError("document too large")
            return json.loads(body)
        except (httpx.HTTPError, ValueError) as error:
            logger.info("Catalogue request failed: %s (%s)", url, error)
            self._failed[url] = self._clock() + _FAILED_FOR_S
            raise _unavailable(source) from error

    def download(self, source: str, url: str, target: Path, max_bytes: int, report: Report) -> None:
        """Stream a file to disk, reporting the first half of the job's progress.

        Args:
            source: Catalogue the address came from; decides which hosts are allowed.
            url: Address taken from that catalogue's own data.
            target: File to write.
            max_bytes: Largest accepted body.
            report: Progress callback; it raises to cancel, which removes the partial file.

        Raises:
            ImageryError: ``imageryDownloadNotAllowed``, ``imageryTooLarge`` or
                ``imageryDownloadFailed``.
        """
        if not is_allowed(source, url):
            raise not_allowed()
        megabytes = max_bytes // (1024 * 1024)
        too_large = ImageryError(
            "imageryTooLarge", f"영상 파일은 {megabytes} MB 이하만 가져올 수 있음", max_mb=megabytes
        )
        try:
            with self._client.stream(
                "GET", url, timeout=_DOWNLOAD_TIMEOUT, follow_redirects=False
            ) as response:
                if response.status_code != 200:
                    raise _download_failed()
                # A compressed transfer would make the byte count meaningless as a size cap.
                if response.headers.get("content-encoding", "identity") != "identity":
                    raise _download_failed()
                declared = response.headers.get("content-length", "")
                total = int(declared) if declared.isdigit() else 0
                if total > max_bytes:
                    raise too_large
                written = 0
                with target.open("wb") as output:
                    # No content encoding was accepted above, so these are the bytes on the wire.
                    for chunk in response.iter_bytes(_CHUNK):
                        written += len(chunk)
                        if written > max_bytes:
                            raise too_large
                        output.write(chunk)
                        report(0.5 * written / total if total else 0.0, "downloading")
        except httpx.HTTPError as error:
            logger.info("Imagery download failed: %s (%s)", url, error)
            target.unlink(missing_ok=True)
            raise _download_failed() from error
        except BaseException:
            target.unlink(missing_ok=True)
            raise
