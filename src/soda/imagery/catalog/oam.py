"""OpenAerialMap: openly licensed aerial, drone and satellite imagery with a search API."""

import re
from typing import Any

from ..formats import ImageryError
from ..limits import MAX_CATALOG_RESULTS, MAX_IMAGERY_BYTES, MAX_NAME_LENGTH
from . import Candidate, Resolved
from .cache import JsonCache
from .http import CatalogHttp, is_allowed, not_allowed

SOURCE = "oam"
API = "https://api.openaerialmap.org/meta"
ID_PATTERN = re.compile(r"[0-9a-f]{24}")
_SEARCH_TTL_S = 3600.0
Box = tuple[float, float, float, float]


def _unknown() -> ImageryError:
    return ImageryError("imageryCatalogItemUnknown", "카탈로그에서 찾을 수 없는 항목")


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _attribution(result: dict[str, Any]) -> str:
    provider = _text(result.get("provider"))
    return f"{provider} / OpenAerialMap" if provider else "OpenAerialMap"


def _license(result: dict[str, Any]) -> str:
    properties = result.get("properties")
    return _text(properties.get("license")) if isinstance(properties, dict) else ""


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _candidate(result: dict[str, Any]) -> Candidate | None:
    item_id, box, url = result.get("_id"), result.get("bbox"), result.get("uuid")
    if not (isinstance(item_id, str) and ID_PATTERN.fullmatch(item_id)):
        return None
    if not (isinstance(box, list) and len(box) == 4 and all(_number(v) is not None for v in box)):
        return None
    size = _number(result.get("file_size"))
    reason = None
    if not (isinstance(url, str) and is_allowed(SOURCE, url)):
        reason = "hostNotAllowed"
    elif size is not None and size > MAX_IMAGERY_BYTES:
        reason = "tooLarge"
    return Candidate(
        source=SOURCE,
        item_id=item_id,
        title=_text(result.get("title")) or item_id,
        west_deg=float(box[0]),
        south_deg=float(box[1]),
        east_deg=float(box[2]),
        north_deg=float(box[3]),
        gsd_m=_number(result.get("gsd")),
        acquired_at=_text(result.get("acquisition_start")) or None,
        license=_license(result),
        attribution=_attribution(result),
        size_bytes=int(size) if size is not None else None,
        pixels=None,
        clouds_percent=None,
        importable=reason is None,
        reason=reason,
    )


def search(http: CatalogHttp, cache: JsonCache, box: Box) -> list[Candidate]:
    """Items whose footprint touches a box, finest resolution first; one request, cached."""
    rounded = ",".join(f"{value:.3f}" for value in box)
    key = f"oam:search:{rounded}"
    data = cache.get(key, _SEARCH_TTL_S)
    if data is None:
        url = f"{API}?bbox={rounded}&limit={MAX_CATALOG_RESULTS}&order_by=gsd&sort=asc"
        data = http.get_json(SOURCE, url)
        cache.put(key, data)
    results = data.get("results") if isinstance(data, dict) else None
    found = [_candidate(item) for item in results or [] if isinstance(item, dict)]
    return [candidate for candidate in found if candidate is not None]


def check_id(item_id: str) -> None:
    """Raise ``imageryCatalogItemUnknown`` unless the text has the shape of an item id."""
    if not ID_PATTERN.fullmatch(item_id):
        raise _unknown()


def provisional_name(item_id: str) -> str:
    """What to call an import before the catalogue has told its title."""
    return f"OpenAerialMap {item_id[:8]}"


def resolve(http: CatalogHttp, cache: JsonCache, item_id: str) -> Resolved:
    """Look an item up again by id and return where its image is.

    Raises:
        ImageryError: ``imageryCatalogItemUnknown``, ``imageryDownloadNotAllowed`` or
            ``imageryCatalogUnavailable``.
    """
    check_id(item_id)
    data = http.get_json(SOURCE, f"{API}/{item_id}")
    result = data.get("results") if isinstance(data, dict) else None
    url = result.get("uuid") if isinstance(result, dict) else None
    if not isinstance(result, dict) or not isinstance(url, str):
        raise _unknown()
    if not is_allowed(SOURCE, url):
        raise not_allowed()
    return Resolved(
        url=url,
        name=(_text(result.get("title")) or provisional_name(item_id))[:MAX_NAME_LENGTH],
        attribution=_attribution(result),
        license=_license(result),
        acquired_at=_text(result.get("acquisition_start")) or None,
        gsd_m=_number(result.get("gsd")),
    )
