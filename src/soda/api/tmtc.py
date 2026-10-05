"""Simulated TC/TM link: start a session over a pass schedule, then talk over a WebSocket."""

import asyncio
from typing import Any

from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect

from ..errors import message
from ..orbit.passes import find_passes_multi
from ..orbit.propagator import PropagationRequestError
from ..tmtc.link import Contact
from ..tmtc.packets import Code, Command, Mode, PacketError
from ..tmtc.session import Session
from .errors import ApiError
from .orbit import element_set_of, kernel_of, observer_of, resolve, stations_of
from .schemas import TmtcSessionRequest

router = APIRouter()


def _ms(value: Any) -> int:
    return round(value.timestamp() * 1000)


@router.post("/tmtc/session")
async def start_session(request: Request, body: TmtcSessionRequest) -> dict:
    """Replace the running session with one over this satellite's passes."""
    stations = stations_of(request, body.station_ids)
    resolved = await resolve(request, body)
    kernel = await kernel_of(request)
    observers = [observer_of(station, station.min_elev_deg) for station in stations]
    try:
        found = await asyncio.to_thread(
            find_passes_multi, resolved.elements.omm, observers, body.start, body.end, kernel
        )
    except PropagationRequestError as error:
        raise ApiError.of(422, error) from error
    contacts = [
        Contact(
            _ms(p["aos"]),
            _ms(p["los"]),
            station.id,
            p["tca_range_km"],
            tuple(p["track_fixed_m"]),
        )
        for station, passes in zip(stations, found, strict=True)
        for p in passes
    ]
    session = Session.over(contacts, resolved.elements.name)
    await request.app.state.tmtc.replace(session)
    return {
        **session.status(),
        "element_set": element_set_of(resolved, body),
    }


@router.get("/tmtc/session")
async def session_status(request: Request) -> dict:
    session = request.app.state.tmtc.session
    return session.status() if session else {"type": "stopped"}


@router.delete("/tmtc/session", status_code=204)
async def stop_session(request: Request) -> Response:
    await request.app.state.tmtc.replace(None)
    return Response(status_code=204)


def command_from_json(raw: Any) -> Command:
    """A command as the frontend sends it, e.g. ``{"command": "SET_MODE", "mode": "SAFE"}``.

    Raises:
        PacketError: Unknown command, mode, or a malformed time tag.
    """
    if not isinstance(raw, dict):
        raise PacketError("a command is an object")
    try:
        code = Code[str(raw.get("command"))]
        if code == Code.SET_MODE:
            return Command(code, mode=Mode[str(raw.get("mode"))])
        if code == Code.TIME_TAG:
            inner = command_from_json(raw.get("inner"))
            command = Command(code, execute_ms=int(raw["execute_ms"]), inner=inner)
            command.body()
            return command
    except (KeyError, TypeError, ValueError) as error:
        raise PacketError(f"bad command: {raw}") from error
    return Command(code)


@router.websocket("/tmtc/ws")
async def tmtc_socket(websocket: WebSocket) -> None:
    """``{"type": "clock", "ms"}`` and ``{"type": "tc", "command"}`` in; packets out."""
    hub = websocket.app.state.tmtc
    await websocket.accept()
    hub.clients.add(websocket)
    await websocket.send_json(hub.session.status() if hub.session else {"type": "stopped"})
    try:
        while True:
            incoming = await websocket.receive_json()
            kind = incoming.get("type") if isinstance(incoming, dict) else None
            if kind == "clock" and isinstance(incoming.get("ms"), int | float):
                await hub.clock(int(incoming["ms"]))
            elif kind == "tc":
                try:
                    command = command_from_json(incoming.get("command"))
                except PacketError as error:
                    text = "명령 형식 오류"
                    await websocket.send_json(
                        {"type": "error", **message("tmtcBadCommand", text, detail=str(error))}
                    )
                    continue
                await hub.command(command)
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(websocket)
