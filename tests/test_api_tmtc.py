"""Simulated TC/TM link endpoints and WebSocket."""

from datetime import datetime

START = "2026-09-16T00:00:00Z"
END = "2026-09-17T00:00:00Z"


def ms(iso: str) -> int:
    return round(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def start_session(client):
    station = client.get("/api/v1/stations").json()[0]["id"]
    body = {"norad_id": 25544, "start": START, "end": END, "station_ids": [station]}
    response = client.post("/api/v1/tmtc/session", json=body)
    assert response.status_code == 200
    return response.json()


def until(socket, kind):
    """Messages up to and including the first of ``kind``."""
    seen = []
    while True:
        message = socket.receive_json()
        seen.append(message)
        if message["type"] == kind:
            return seen


def test_session_lifecycle(client):
    assert client.get("/api/v1/tmtc/session").json()["type"] == "stopped"
    data = start_session(client)
    assert data["type"] == "status" and data["name"] == "ISS (ZARYA)"
    assert len(data["contacts"]) >= 3
    # The track the globe draws the line of sight along.
    for contact in data["contacts"]:
        track = contact["track_fixed_m"]
        assert len(track) >= 6 and len(track) % 3 == 0
    assert client.get("/api/v1/tmtc/session").json()["contacts"] == data["contacts"]
    assert client.delete("/api/v1/tmtc/session").status_code == 204
    assert client.get("/api/v1/tmtc/session").json()["type"] == "stopped"


def test_clock_drives_the_link_over_the_websocket(client):
    contacts = start_session(client)["contacts"]
    first = contacts[0]
    with client.websocket_connect("/api/v1/tmtc/ws") as socket:
        assert socket.receive_json()["type"] == "status"
        socket.send_json({"type": "clock", "ms": first["aos_ms"] - 120_000})
        assert until(socket, "link")[-1]["open"] is False

        # Queued while out of contact, sent once the clock passes AOS.
        socket.send_json({"type": "tc", "command": {"command": "SET_MODE", "mode": "IMAGING"}})
        assert until(socket, "queued")[-1]["queued"] == 1
        socket.send_json({"type": "clock", "ms": first["aos_ms"] + 30_000})
        link = until(socket, "link")[-1]
        assert link["open"] is True and link["station_id"] == contacts[0]["station_id"]
        # Stored housekeeping is played back first, then the queued command goes up.
        messages = []
        while not any(m.get("dir") == "up" for m in messages):
            messages.append(socket.receive_json())
            assert len(messages) < 100
        assert messages[0]["replay"] is True and messages[0]["decoded"]["mode"] == "NOMINAL"
        assert messages[-1]["decoded"] == {"command": "SET_MODE", "mode": "IMAGING"}

        socket.send_json({"type": "tc", "command": {"command": "WARP"}})
        error = until(socket, "error")[-1]
        assert error["code"] == "tmtcBadCommand"
