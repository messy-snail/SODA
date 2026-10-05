"""3D satellite model files served from ``data/models``."""

import asyncio
import logging

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse
from pydantic import ValidationError

from ..models3d import MAX_MODEL_BYTES, GlbError, ModelStore, StoredModel, is_valid_name
from .errors import ApiError
from .schemas import ModelSettings, iso
from .uploads import read_limited_body

logger = logging.getLogger(__name__)
router = APIRouter()

NOT_FOUND = ApiError(404, "modelNotFound", "모델 없음")
BAD_NAME = ApiError(422, "modelBadName", "모델 이름은 default 또는 NORAD 번호여야 함")
BUSY = ApiError(409, "modelBusy", "모델 파일 사용 중 · 잠시 후 다시 시도 필요")


def _store(request: Request) -> ModelStore:
    return ModelStore(request.app.state.settings.models_dir)


def _settings(store: ModelStore, name: str) -> ModelSettings:
    try:
        return ModelSettings.model_validate(store.read_settings(name))
    except ValidationError as error:
        logger.warning("Ignoring invalid settings for model %s: %s", name, error)
        return ModelSettings()


def _info(store: ModelStore, model: StoredModel) -> dict:
    return {
        "name": model.name,
        "norad_id": model.norad_id,
        "size_bytes": model.size_bytes,
        "updated_at": iso(model.updated_at),
        "settings": _settings(store, model.name).model_dump(),
    }


def _existing(store: ModelStore, name: str) -> StoredModel:
    model = store.get(name) if is_valid_name(name) else None
    if model is None:
        raise NOT_FOUND
    return model


@router.get("/models")
def list_models(request: Request) -> list[dict]:
    store = _store(request)
    return [_info(store, model) for model in store.entries()]


@router.get("/models/{name}.glb")
def model_file(request: Request, name: str) -> FileResponse:
    model = _existing(_store(request), name)
    return FileResponse(model.path, media_type="model/gltf-binary")


@router.put("/models/{name}")
async def upload_model(request: Request, name: str) -> dict:
    if not is_valid_name(name):
        raise BAD_NAME
    too_large = ApiError(
        413,
        "modelTooLarge",
        f"모델 파일은 {MAX_MODEL_BYTES // (1024 * 1024)} MB 이하만 업로드 가능",
        max_mb=MAX_MODEL_BYTES // (1024 * 1024),
    )
    body = await read_limited_body(request, MAX_MODEL_BYTES, too_large)
    store = _store(request)
    try:
        model = await asyncio.to_thread(store.save, name, body)
    except GlbError as error:
        raise ApiError.of(422, error) from error
    except PermissionError as error:
        raise BUSY from error
    return _info(store, model)


@router.put("/models/{name}/settings")
def save_model_settings(request: Request, name: str, body: ModelSettings) -> dict:
    store = _store(request)
    model = _existing(store, name)
    try:
        store.save_settings(name, body.model_dump())
    except PermissionError as error:
        raise BUSY from error
    return _info(store, model)


@router.delete("/models/{name}", status_code=204)
def delete_model(request: Request, name: str) -> Response:
    store = _store(request)
    _existing(store, name)
    try:
        store.delete(name)
    except PermissionError as error:
        raise BUSY from error
    return Response(status_code=204)
