"""Maxar Open Data: high-resolution satellite imagery of disaster areas, CC BY-NC 4.0.

The catalogue is a static STAC on S3 with no search API: a root listing events, each event
listing its acquisitions, each acquisition listing its tiles. Two regularities make a box
search cheap enough. An event's ``extent.spatial.bbox`` is its overall box followed by one box
per acquisition, and an acquisition's is one box per tile (after an overall box, in newer
events), in the order of its links. So the
tiles in a box are found from the event and acquisition documents alone, which are cached;
only the handful of tiles shown first are looked up for their details.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..formats import ImageryError
from ..limits import MAX_CATALOG_RESULTS, MAX_NAME_LENGTH
from . import Candidate, Resolved, intersects
from .cache import JsonCache
from .http import CatalogHttp, is_allowed, not_allowed

logger = logging.getLogger(__name__)

SOURCE = "maxar"
ROOT = "https://maxar-opendata.s3.amazonaws.com/events"
LICENSE = "CC BY-NC 4.0"
ATTRIBUTION = "Maxar Open Data Program"
#: ``<event>/<utm zone>/<quadkey>/<date>/<catalog id>``
ID_PATTERN = re.compile(
    r"(?P<event>[A-Za-z0-9][A-Za-z0-9_-]{0,80})/(?P<zone>\d{1,2})/(?P<quadkey>[0-3]{6,20})"
    r"/(?P<date>\d{4}-\d{2}-\d{2})/(?P<catalog>[0-9A-Fa-f]{8,32})"
)
_EVENT_HREF = re.compile(r"\./([A-Za-z0-9][A-Za-z0-9_-]{0,80})/collection\.json")
_ACQUISITION_HREF = re.compile(
    r"\./ard/acquisition_collections/([0-9A-Fa-f]{8,32})_collection\.json"
)
_ITEM_HREF = re.compile(
    r"\.\./(\d{1,2})/([0-3]{6,20})/(\d{4}-\d{2}-\d{2})/([0-9A-Fa-f]{8,32})\.json"
)
_ROOT_TTL_S = 24 * 3600.0
_EVENT_TTL_S = 7 * 24 * 3600.0
_ACQUISITION_TTL_S = 30 * 24 * 3600.0
#: Events one search looks into, acquisitions it may fetch, and tiles it looks up in detail.
_MAX_EVENTS = 3
_MAX_ACQUISITIONS = 40
_MAX_DETAILED = 16
_FETCH_THREADS = 4
Box = tuple[float, float, float, float]


def _unknown() -> ImageryError:
    return ImageryError("imageryCatalogItemUnknown", "카탈로그에서 찾을 수 없는 항목")


def _cached(http: CatalogHttp, cache: JsonCache, url: str, ttl_s: float | None) -> Any:
    data = cache.get(url, ttl_s)
    if data is None:
        data = http.get_json(SOURCE, url)
        cache.put(url, data)
    return data


def _links(document: Any, rel: str) -> list[str]:
    links = document.get("links") if isinstance(document, dict) else None
    return [
        link["href"]
        for link in links or []
        if isinstance(link, dict) and link.get("rel") == rel and isinstance(link.get("href"), str)
    ]


def _boxes(document: Any) -> list[list[float]]:
    try:
        boxes = document["extent"]["spatial"]["bbox"]
    except (KeyError, TypeError):
        return []
    return [box for box in boxes if isinstance(box, list) and len(box) == 4]


def event_ids(http: CatalogHttp, cache: JsonCache) -> list[str]:
    """Ids of every event in the catalogue."""
    root = _cached(http, cache, f"{ROOT}/catalog.json", _ROOT_TTL_S)
    matches = (_EVENT_HREF.fullmatch(href) for href in _links(root, "child"))
    return [match.group(1) for match in matches if match]


def _events(http: CatalogHttp, cache: JsonCache) -> dict[str, Any]:
    """Every event's collection document, fetched a few at a time on first use."""
    ids = event_ids(http, cache)

    def load(event: str) -> tuple[str, Any]:
        try:
            return event, _cached(http, cache, f"{ROOT}/{event}/collection.json", _EVENT_TTL_S)
        except ImageryError:
            # One unreachable event must not hide the others; it is asked again later.
            return event, None

    with ThreadPoolExecutor(max_workers=_FETCH_THREADS) as pool:
        return {event: document for event, document in pool.map(load, ids) if document}


def _acquisitions(event: Any, box: Box) -> list[str]:
    """Catalog ids of an event's acquisitions that may touch the box."""
    hrefs = _links(event, "child")
    boxes = _boxes(event)
    # The first box is the whole event; the rest pair with the child links when they line up.
    paired = len(boxes) == len(hrefs) + 1
    found = []
    for index, href in enumerate(hrefs):
        match = _ACQUISITION_HREF.fullmatch(href)
        if match and (not paired or intersects(box, boxes[index + 1])):
            found.append(match.group(1))
    return found


def _title(event_title: str, date: str, quadkey: str) -> str:
    return f"{event_title} {date} {quadkey[-4:]}"[:MAX_NAME_LENGTH]


def _detail(candidate: Candidate, item: Any) -> Candidate:
    """A candidate with what its item document adds: resolution, cloud and size."""
    if not isinstance(item, dict):
        return candidate
    properties = item.get("properties") if isinstance(item.get("properties"), dict) else {}
    assets = item.get("assets") if isinstance(item.get("assets"), dict) else {}
    visual = assets.get("visual") if isinstance(assets.get("visual"), dict) else {}
    shape = visual.get("proj:shape")
    gsd, clouds = properties.get("gsd"), properties.get("tile:clouds_percent")
    moment = properties.get("datetime")
    return Candidate(
        **{
            **candidate.as_dict(),
            "gsd_m": float(gsd) if isinstance(gsd, int | float) else None,
            "clouds_percent": float(clouds) if isinstance(clouds, int | float) else None,
            "pixels": (
                int(shape[0]) * int(shape[1])
                if isinstance(shape, list) and len(shape) == 2
                else None
            ),
            "acquired_at": _iso(moment) if isinstance(moment, str) else candidate.acquired_at,
        }
    )


def _iso(moment: str) -> str:
    """Maxar writes ``2024-01-02 01:57:43Z``; the rest of SODA uses a ``T``."""
    return moment.strip().replace(" ", "T")


def _item_url(match: re.Match[str]) -> str:
    return (
        f"{ROOT}/{match['event']}/ard/{match['zone']}/{match['quadkey']}"
        f"/{match['date']}/{match['catalog']}.json"
    )


def search(http: CatalogHttp, cache: JsonCache, box: Box) -> list[Candidate]:
    """Tiles whose footprint touches a box, newest first.

    The first search fetches every event document (small, cached for a week). After that a
    search costs only the acquisition documents it has not seen and a few tile lookups.
    """
    events = [
        (event, document)
        for event, document in _events(http, cache).items()
        if (boxes := _boxes(document)) and intersects(box, boxes[0])
    ][:_MAX_EVENTS]
    found: list[Candidate] = []
    budget = _MAX_ACQUISITIONS
    for event, document in events:
        title = str(document.get("title") or event)
        for catalog_id in _acquisitions(document, box)[:budget]:
            budget -= 1
            url = f"{ROOT}/{event}/ard/acquisition_collections/{catalog_id}_collection.json"
            acquisition = _cached(http, cache, url, _ACQUISITION_TTL_S)
            hrefs, boxes = _links(acquisition, "item"), _boxes(acquisition)
            # Newer events put the acquisition's overall box before the per-tile ones.
            if len(boxes) == len(hrefs) + 1:
                boxes = boxes[1:]
            if len(hrefs) != len(boxes):
                logger.info("Maxar acquisition %s: boxes do not pair with tiles", catalog_id)
                continue
            for href, tile in zip(hrefs, boxes, strict=True):
                match = _ITEM_HREF.fullmatch(href)
                if not match or not intersects(box, tile):
                    continue
                zone, quadkey, date, catalog = match.groups()
                found.append(
                    Candidate(
                        source=SOURCE,
                        item_id=f"{event}/{zone}/{quadkey}/{date}/{catalog}",
                        title=_title(title, date, quadkey),
                        west_deg=float(tile[0]),
                        south_deg=float(tile[1]),
                        east_deg=float(tile[2]),
                        north_deg=float(tile[3]),
                        gsd_m=None,
                        acquired_at=f"{date}T00:00:00Z",
                        license=LICENSE,
                        attribution=ATTRIBUTION,
                        size_bytes=None,
                        pixels=None,
                        clouds_percent=None,
                    )
                )
    found.sort(key=lambda candidate: candidate.acquired_at or "", reverse=True)
    found = found[:MAX_CATALOG_RESULTS]

    def detail(candidate: Candidate) -> Candidate:
        match = ID_PATTERN.fullmatch(candidate.item_id)
        try:
            return (
                _detail(candidate, _cached(http, cache, _item_url(match), None))
                if match
                else candidate
            )
        except ImageryError:
            return candidate

    with ThreadPoolExecutor(max_workers=_FETCH_THREADS) as pool:
        return [*pool.map(detail, found[:_MAX_DETAILED]), *found[_MAX_DETAILED:]]


def check_id(item_id: str) -> None:
    """Raise ``imageryCatalogItemUnknown`` unless the text has the shape of an item id."""
    if not ID_PATTERN.fullmatch(item_id):
        raise _unknown()


def provisional_name(item_id: str) -> str:
    """What to call an import before the catalogue has told its title."""
    match = ID_PATTERN.fullmatch(item_id)
    if not match:
        return item_id[:MAX_NAME_LENGTH]
    return _title(match["event"].replace("-", " "), match["date"], match["quadkey"])


def resolve(http: CatalogHttp, cache: JsonCache, item_id: str) -> Resolved:
    """Look a tile up again by id and return where its visual image is.

    Raises:
        ImageryError: ``imageryCatalogItemUnknown``, ``imageryDownloadNotAllowed`` or
            ``imageryCatalogUnavailable``.
    """
    match = ID_PATTERN.fullmatch(item_id)
    if not match or match["event"] not in event_ids(http, cache):
        raise _unknown()
    item_url = _item_url(match)
    item = _cached(http, cache, item_url, None)
    try:
        href = item["assets"]["visual"]["href"]
        properties = item.get("properties") or {}
    except (KeyError, TypeError) as error:
        raise _unknown() from error
    # The asset sits beside its item; anything else is not the file this id names.
    expected = f"./{match['catalog']}-visual.tif"
    if href != expected:
        raise _unknown()
    url = item_url.rsplit("/", 1)[0] + href[1:]
    if not is_allowed(SOURCE, url):
        raise not_allowed()
    events = _events(http, cache)
    title = str((events.get(match["event"]) or {}).get("title") or match["event"])
    moment, gsd = properties.get("datetime"), properties.get("gsd")
    return Resolved(
        url=url,
        name=_title(title, match["date"], match["quadkey"]),
        attribution=ATTRIBUTION,
        license=LICENSE,
        acquired_at=_iso(moment) if isinstance(moment, str) else None,
        gsd_m=float(gsd) if isinstance(gsd, int | float) and gsd > 0 else None,
    )
