"""Ground station management."""

from fastapi import APIRouter, Request, Response

from ..gp.store import StationNameTaken
from .errors import ApiError
from .schemas import StationCreate, station_summary

router = APIRouter()


@router.get("/stations")
def list_stations(request: Request) -> list[dict]:
    return [station_summary(station) for station in request.app.state.gp.store.stations()]


@router.post("/stations", status_code=201)
def create_station(request: Request, body: StationCreate) -> dict:
    try:
        station = request.app.state.gp.store.add_station(**body.store_fields())
    except StationNameTaken as error:
        raise ApiError(409, "stationNameTaken", "같은 이름의 지상국이 이미 있음") from error
    return station_summary(station)


@router.put("/stations/{station_id}")
def update_station(request: Request, station_id: int, body: StationCreate) -> dict:
    """Replace a station in place, so the id a prediction and its colour hang off survives."""
    try:
        station = request.app.state.gp.store.update_station(station_id, **body.store_fields())
    except StationNameTaken as error:
        raise ApiError(409, "stationNameTaken", "같은 이름의 지상국이 이미 있음") from error
    if station is None:
        raise ApiError(404, "stationNotFound", "지상국 없음")
    return station_summary(station)


@router.delete("/stations/{station_id}", status_code=204)
def delete_station(request: Request, station_id: int) -> Response:
    if not request.app.state.gp.store.delete_station(station_id):
        raise ApiError(404, "stationNotFound", "지상국 없음")
    return Response(status_code=204)
