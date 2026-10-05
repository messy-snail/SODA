"""Orbital elements the user pasted in or imported from a file, as TLE or OMM."""

import asyncio
from typing import Any

from fastapi import APIRouter, Request, Response

from ..errors import CodedError
from ..gp.element_files import MAX_ELEMENT_FILE_BYTES, parse_element_file, plan_import
from ..gp.store import CustomElementNameTaken, CustomElements
from ..gp.tle import parse_custom_elements
from .errors import ApiError
from .schemas import CustomElementsCreate, custom_summary, element_detail
from .uploads import read_limited_body

router = APIRouter()


def custom_detail(custom: CustomElements) -> dict[str, Any]:
    """The ``/catalog/{norad_id}`` shape, plus where the elements came from."""
    return {
        **element_detail(custom.element_set(), []),
        "custom_id": custom.id,
        "input_format": custom.input_format,
        "created_at": custom.created_at,
    }


def load_custom(request: Request, custom_id: int) -> CustomElements:
    """Stored user elements.

    Raises:
        ApiError: 404 ``customElementNotFound`` when the id is unknown.
    """
    custom = request.app.state.gp.store.custom_element(custom_id)
    if custom is None:
        raise ApiError(404, "customElementNotFound", "사용자 궤도요소 없음", id=custom_id)
    return custom


@router.get("/custom-elements")
def list_custom_elements(request: Request) -> list[dict]:
    return [custom_summary(c) for c in request.app.state.gp.store.custom_elements()]


@router.get("/custom-elements/{custom_id}")
def get_custom_element(request: Request, custom_id: int) -> dict:
    return custom_detail(load_custom(request, custom_id))


@router.post("/custom-elements", status_code=201)
def create_custom_element(request: Request, body: CustomElementsCreate) -> dict:
    try:
        omm, input_format = parse_custom_elements(body.text)
    except CodedError as error:
        raise ApiError.of(422, error) from error
    try:
        custom = request.app.state.gp.store.add_custom_element(body.name, omm, input_format)
    except CustomElementNameTaken as error:
        raise ApiError(
            409, "customElementNameTaken", "같은 이름의 사용자 궤도요소가 이미 있음"
        ) from error
    return custom_detail(custom)


@router.post("/custom-elements/import")
async def import_custom_elements(request: Request) -> dict:
    """Store every usable record of an uploaded TLE or OMM file (the raw request body)."""
    megabytes = MAX_ELEMENT_FILE_BYTES // (1024 * 1024)
    too_large = ApiError(
        413,
        "elementFileTooLarge",
        f"궤도요소 파일은 {megabytes} MB 이하만 가져오기 가능",
        max_mb=megabytes,
    )
    body = await read_limited_body(request, MAX_ELEMENT_FILE_BYTES, too_large)
    store = request.app.state.gp.store

    def run() -> dict:
        try:
            file_format, records = parse_element_file(body.decode("utf-8"))
        except UnicodeDecodeError as error:
            raise ApiError(422, "elementFileUnreadable", "UTF-8 텍스트 파일이 아님") from error
        except CodedError as error:
            raise ApiError.of(422, error) from error
        existing = {
            custom.name: (int(custom.omm["NORAD_CAT_ID"]), str(custom.omm["EPOCH"]))
            for custom in store.custom_elements()
        }
        plan = plan_import(records, existing)
        created = store.add_custom_elements(plan.create)
        return {
            "format": file_format,
            "total": len(records),
            "created": [custom_summary(custom) for custom in created],
            "skipped": [
                {"index": index, "name": name, "reason": reason}
                for index, name, reason in plan.skipped
            ],
        }

    return await asyncio.to_thread(run)


@router.delete("/custom-elements/{custom_id}", status_code=204)
def delete_custom_element(request: Request, custom_id: int) -> Response:
    if not request.app.state.gp.store.delete_custom_element(custom_id):
        raise ApiError(404, "customElementNotFound", "사용자 궤도요소 없음", id=custom_id)
    return Response(status_code=204)
