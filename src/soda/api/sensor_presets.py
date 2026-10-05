"""User-saved sensor presets for swath runs."""

from fastapi import APIRouter, Request, Response

from ..gp.store import SensorPresetNameTaken
from .errors import ApiError
from .schemas import SensorPresetCreate, sensor_preset_summary

router = APIRouter()


@router.get("/sensor-presets")
def list_sensor_presets(request: Request) -> list[dict]:
    return [sensor_preset_summary(p) for p in request.app.state.gp.store.sensor_presets()]


@router.post("/sensor-presets", status_code=201)
def create_sensor_preset(request: Request, body: SensorPresetCreate) -> dict:
    try:
        preset = request.app.state.gp.store.add_sensor_preset(**body.model_dump())
    except SensorPresetNameTaken as error:
        raise ApiError(
            409, "sensorPresetNameTaken", "같은 이름의 센서 프리셋이 이미 있음"
        ) from error
    return sensor_preset_summary(preset)


@router.put("/sensor-presets/{preset_id}")
def update_sensor_preset(request: Request, preset_id: int, body: SensorPresetCreate) -> dict:
    """Replace a preset in place so its id survives edits."""
    try:
        preset = request.app.state.gp.store.update_sensor_preset(preset_id, **body.model_dump())
    except SensorPresetNameTaken as error:
        raise ApiError(
            409, "sensorPresetNameTaken", "같은 이름의 센서 프리셋이 이미 있음"
        ) from error
    if preset is None:
        raise ApiError(404, "sensorPresetNotFound", "센서 프리셋 없음")
    return sensor_preset_summary(preset)


@router.delete("/sensor-presets/{preset_id}", status_code=204)
def delete_sensor_preset(request: Request, preset_id: int) -> Response:
    if not request.app.state.gp.store.delete_sensor_preset(preset_id):
        raise ApiError(404, "sensorPresetNotFound", "센서 프리셋 없음")
    return Response(status_code=204)
