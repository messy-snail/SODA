"""Pass prediction for one or more satellites over shared stations, deconflicted.

With one satellite this is a plain pass prediction. With several, a station can only
serve one at a time, so overlapping passes are marked and handed out by satellite priority
(``orbit.contacts.schedule``).
"""

import asyncio
from typing import Any

from fastapi import APIRouter, Request

from ..orbit.contacts import Contact, ContactRequestError, check_request, contact_id, schedule
from ..orbit.passes import find_passes_multi
from ..orbit.propagator import (
    PropagationRequestError,
    as_utc,
    epoch_warnings,
    orbit_summary,
)
from .errors import ApiError
from .orbit import element_set_of, kernel_of, observer_of, resolve, stations_of, visibility
from .schemas import PassesRequest, iso, station_summary

router = APIRouter()


@router.post("/passes")
async def passes(request: Request, body: PassesRequest) -> dict:
    """Passes of each satellite over each station; the first satellite wins a conflict."""
    try:
        check_request([(as_utc(s.start), as_utc(s.end)) for s in body.satellites])
    except ContactRequestError as error:
        raise ApiError.of(422, error) from error
    stations = stations_of(request, body.station_ids)
    resolved = [await resolve(request, satellite) for satellite in body.satellites]
    kernel = await kernel_of(request)
    min_elevations = [
        station.min_elev_deg if body.min_elev_deg is None else body.min_elev_deg
        for station in stations
    ]
    observers = [
        observer_of(station, minimum)
        for station, minimum in zip(stations, min_elevations, strict=True)
    ]

    def compute() -> list[list[list[dict[str, Any]]]]:
        return [
            find_passes_multi(item.elements.omm, observers, sat.start, sat.end, kernel)
            for item, sat in zip(resolved, body.satellites, strict=True)
        ]

    try:
        found = await asyncio.to_thread(compute)
    except PropagationRequestError as error:
        raise ApiError.of(422, error) from error

    plan: list[Contact] = []
    by_id: dict[str, dict[str, Any]] = {}
    for index, by_station in enumerate(found):
        for station, station_passes in zip(stations, by_station, strict=True):
            for item in station_passes:
                key = contact_id(index, station.id, item["aos"])
                item.update(id=key, satellite_index=index, station_id=station.id)
                by_id[key] = item
                plan.append(Contact(key, index, station.id, item["aos"], item["los"]))
    for contact in schedule(plan, body.turnaround_s):
        item = by_id[contact.id]
        item["status"] = "assigned" if contact.assigned else "rejected"
        item["conflict_with"] = contact.conflict_with
        for key in ("aos", "tca", "los"):
            item[key] = iso(item[key])

    satellites = []
    for index, (item, sat, by_station) in enumerate(
        zip(resolved, body.satellites, found, strict=True)
    ):
        orbit = orbit_summary(item.elements.omm)
        mean_alt = (orbit["apogee_alt_km"] + orbit["perigee_alt_km"]) / 2
        satellites.append(
            {
                "index": index,
                "element_set": element_set_of(item, sat),
                "start": iso(as_utc(sat.start)),
                "end": iso(as_utc(sat.end)),
                "results": [
                    {
                        "station": station_summary(station),
                        "min_elev_deg": minimum,
                        "visibility": visibility(station, mean_alt, minimum),
                        "passes": station_passes,
                    }
                    for station, minimum, station_passes in zip(
                        stations, min_elevations, by_station, strict=True
                    )
                ],
            }
        )
    return {
        "satellites": satellites,
        "turnaround_s": body.turnaround_s,
        "assigned": sum(item["status"] == "assigned" for item in by_id.values()),
        "rejected": sum(item["status"] == "rejected" for item in by_id.values()),
        "warnings": [
            w
            for item, sat in zip(resolved, body.satellites, strict=True)
            for w in [*item.warnings, *epoch_warnings(item.elements.epoch, sat.start, sat.end)]
        ],
    }
