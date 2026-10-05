"""Look inside the database, and back up or restore the user's own data.

Browsing is read-only. Import only adds stations, sensor presets, and custom elements; the
element cache and ``fetch_log`` are never written here, since the CelesTrak request budget
depends on them.
"""

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from ..errors import CodedError
from ..gp.sources import CustomStateNameTaken
from ..gp.store import (
    CustomElementNameTaken,
    SensorPresetNameTaken,
    StationNameTaken,
)
from ..gp.tle import parse_custom_elements
from ..orbit.opm import stored_state
from .errors import ApiError
from .schemas import UserDataImport, sensor_preset_summary, station_summary

router = APIRouter()

EXPORT_FORMAT = "soda-userdata"


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d-%H%M%S")


@router.get("/database/tables")
def list_tables(request: Request) -> list[dict]:
    """Browsable tables with their columns and row counts."""
    return [
        {"name": info.name, "columns": list(info.columns), "count": info.count}
        for info in request.app.state.gp.store.tables()
    ]


@router.get("/database/tables/{table}")
def browse_table(
    request: Request,
    table: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: str = Query("", max_length=100),
) -> dict:
    """One page of a table's raw rows."""
    try:
        page = request.app.state.gp.store.browse(table, offset, limit, q)
    except KeyError as error:
        raise ApiError(404, "databaseTableUnknown", "볼 수 없는 테이블", table=table) from error
    return {
        "table": page.table,
        "columns": list(page.columns),
        "rows": page.rows,
        "total": page.total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/database/export")
def export_user_data(request: Request) -> JSONResponse:
    """Stations, sensor presets, and custom elements as one downloadable JSON file."""
    store = request.app.state.gp.store
    body = {
        "format": EXPORT_FORMAT,
        "version": 1,
        "exported_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stations": [station_summary(station) for station in store.stations()],
        "sensor_presets": [sensor_preset_summary(preset) for preset in store.sensor_presets()],
        "custom_elements": [
            {
                "name": c.name,
                "omm": c.omm,
                "input_format": c.input_format,
                "created_at": c.created_at,
            }
            for c in store.custom_elements()
        ],
        "custom_states": [
            {
                "name": c.name,
                "epoch": c.epoch,
                "frame": c.frame,
                "state": c.state,
                "input_format": c.input_format,
                "created_at": c.created_at,
            }
            for c in store.custom_states()
        ],
    }
    filename = f"soda-userdata-{_stamp()}.json"
    return JSONResponse(body, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/database/import")
def import_user_data(request: Request, body: UserDataImport) -> dict:
    """Add what the file holds. Entries whose name is taken or that fail checks are skipped."""
    store = request.app.state.gp.store
    added = {"stations": 0, "sensor_presets": 0, "custom_elements": 0, "custom_states": 0}
    skipped: list[dict] = []
    for station in body.stations:
        try:
            store.add_station(**station.store_fields())
            added["stations"] += 1
        except StationNameTaken:
            skipped.append({"kind": "stations", "name": station.name, "reason": "nameTaken"})
    for preset in body.sensor_presets:
        try:
            store.add_sensor_preset(**preset.model_dump())
            added["sensor_presets"] += 1
        except SensorPresetNameTaken:
            skipped.append({"kind": "sensor_presets", "name": preset.name, "reason": "nameTaken"})
    for custom in body.custom_elements:
        try:
            # The single OMM entry point: normalize_omm plus the SGP4 check.
            omm, _ = parse_custom_elements(json.dumps(custom.omm))
            store.add_custom_element(custom.name, omm, custom.input_format)
            added["custom_elements"] += 1
        except CodedError:
            skipped.append({"kind": "custom_elements", "name": custom.name, "reason": "invalid"})
        except CustomElementNameTaken:
            skipped.append({"kind": "custom_elements", "name": custom.name, "reason": "nameTaken"})
    for state in body.custom_states:
        try:
            checked = stored_state(state.name, state.epoch, state.frame, state.state)
            store.add_custom_state(
                checked.name,
                checked.epoch.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                checked.frame,
                checked.stored(),
                state.input_format,
            )
            added["custom_states"] += 1
        except CodedError:
            skipped.append({"kind": "custom_states", "name": state.name, "reason": "invalid"})
        except CustomStateNameTaken:
            skipped.append({"kind": "custom_states", "name": state.name, "reason": "nameTaken"})
    return {"added": added, "skipped": skipped}


@router.get("/database/download")
def download_database(request: Request) -> FileResponse:
    """A consistent snapshot of the whole database file."""
    descriptor, name = tempfile.mkstemp(prefix="soda-", suffix=".db")
    os.close(descriptor)
    target = Path(name)
    request.app.state.gp.store.backup_to(target)
    return FileResponse(
        target,
        media_type="application/vnd.sqlite3",
        filename=f"soda-{_stamp()}.db",
        background=BackgroundTask(target.unlink, missing_ok=True),
    )
