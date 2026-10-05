"""CelesTrak GP API client.

CelesTrak updates GP data every 2 hours and answers repeated downloads of unchanged data
with HTTP 403 ("GP data has not updated since your last successful download"). More than
50 HTTP errors in 2 hours puts the client IP behind the firewall, so callers must go through
``GPService``, which enforces the request budget.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

FetchStatus = Literal["ok", "not_modified", "not_found", "error"]
#: Groups SODA may download, in the order the UI lists them.
GROUP_ORDER = (
    "active",
    "stations",
    "visual",
    "weather",
    "noaa",
    "goes",
    "resource",
    "sarsat",
    "planet",
    "spire",
    "science",
    "geodetic",
    "engineering",
    "education",
    "gnss",
    "gps-ops",
    "galileo",
    "beidou",
    "geo",
    "starlink",
    "oneweb",
    "iridium-NEXT",
    "cubesat",
    "last-30-days",
)
ALLOWED_GROUPS = frozenset(GROUP_ORDER)


@dataclass(frozen=True)
class FetchResult:
    status: FetchStatus
    records: list[dict[str, Any]] = field(default_factory=list)
    detail: str = ""


def interpret(response: httpx.Response) -> FetchResult:
    """Map a CelesTrak response onto a fetch outcome without raising."""
    text = response.text.strip()
    if response.status_code == 403 and "has not updated" in text:
        return FetchResult("not_modified", detail=text[:200])
    if response.status_code != 200:
        return FetchResult("error", detail=f"HTTP {response.status_code}: {text[:200]}")
    if not text or text.startswith("No GP data found"):
        return FetchResult("not_found", detail=text[:200])
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return FetchResult("error", detail=f"unexpected body: {text[:200]}")
    if not isinstance(payload, list):
        return FetchResult("error", detail="unexpected JSON shape")
    if not payload:
        return FetchResult("not_found")
    return FetchResult("ok", records=payload)


class CelesTrakClient:
    """Performs single GP requests. Rate rules live in the service layer."""

    def __init__(self, client: httpx.AsyncClient, url: str) -> None:
        self._client = client
        self._url = url

    async def _get(self, params: dict[str, str]) -> FetchResult:
        try:
            response = await self._client.get(
                self._url, params={**params, "FORMAT": "json"}, timeout=60
            )
        except httpx.HTTPError as error:
            logger.warning("CelesTrak request failed: %s", error)
            return FetchResult("error", detail=f"{type(error).__name__}: {error}")
        result = interpret(response)
        logger.info("CelesTrak %s -> %s (%d records)", params, result.status, len(result.records))
        return result

    async def fetch_group(self, group: str) -> FetchResult:
        if group not in ALLOWED_GROUPS:
            raise ValueError(f"unsupported CelesTrak group {group!r}")
        return await self._get({"GROUP": group})

    async def fetch_catnr(self, norad_id: int) -> FetchResult:
        return await self._get({"CATNR": str(norad_id)})
