"""GP data status, catalog search, and bulk element sets."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response

from ..gp.celestrak import ALLOWED_GROUPS, GROUP_ORDER
from ..gp.classify import classify
from ..gp.service import ElementsUnavailable, GPService
from .errors import ApiError
from .schemas import element_detail, element_summary, iso

router = APIRouter()

Category = Literal["LEO", "MEO", "GEO", "HEO", "DEBRIS"]


def service(request: Request) -> GPService:
    return request.app.state.gp


@router.get("/status")
def status(request: Request) -> dict:
    settings = request.app.state.settings
    data = service(request).status()
    for fetch in data["fetches"]:
        for key in ("last_attempt_at", "last_ok_at", "next_allowed_at"):
            fetch[key] = iso(fetch[key])
    return {
        **data,
        "auto_refresh": settings.auto_refresh,
        "refresh_groups": list(settings.refresh_groups),
    }


@router.get("/catalog/search")
def search(
    request: Request,
    q: str = Query(default="", max_length=60),
    group: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    category: Annotated[list[Category] | None, Query()] = None,
) -> list[dict]:
    """Name or NORAD ID search; repeated ``category`` keeps those ``classify`` results."""
    results = service(request).store.search(q, group, limit, category=category)
    return [{**element_summary(e), "category": classify(e.omm)} for e in results]


@router.get("/catalog/groups")
def groups(request: Request) -> list[dict]:
    """Every group SODA may download, with what is cached for it.

    Declared before ``/catalog/{norad_id}``, which would otherwise take ``groups`` as an id.
    """
    store = service(request).store
    counts = store.group_counts()
    fetched = {
        record.key: record.last_ok_at
        for record in store.fetch_records()
        if record.source == "celestrak"
    }
    auto = set(request.app.state.settings.refresh_groups)
    return [
        {
            "name": name,
            "cached_count": counts.get(name, 0),
            "fetched_at": iso(fetched.get(f"group:{name}")),
            "auto_refresh": name in auto,
        }
        for name in GROUP_ORDER
    ]


@router.get("/catalog/{norad_id}")
async def detail(request: Request, norad_id: int) -> dict:
    gp = service(request)
    try:
        elements = await gp.latest(norad_id)
    except ElementsUnavailable as error:
        raise ApiError.of(404, error) from error
    return element_detail(elements, gp.store.groups_of(norad_id))


def _check_group(group: str) -> None:
    if group not in ALLOWED_GROUPS:
        raise ApiError(404, "unsupportedGroup", f"지원하지 않는 그룹: {group}", group=group)


@router.get("/gp/{group}")
def group_elements(request: Request, group: str) -> Response:
    _check_group(group)
    body, etag = service(request).group_payload(group)
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="application/json", headers=headers)


@router.post("/gp/{group}/refresh")
async def refresh_group(request: Request, group: str) -> dict:
    _check_group(group)
    result = await service(request).refresh_group(group)
    return {"group": group, "result": result}
