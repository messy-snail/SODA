"""Propagation, swath, and pass prediction endpoints."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from skyfield.jpllib import SpiceKernel

from ..errors import message
from ..gp.service import ElementsUnavailable, GPService, ResolvedElements
from ..gp.store import Station
from ..orbit.eclipse import eclipse_intervals_s
from ..orbit.footprint import (
    circle_lonlat,
    footprint_radii_km,
    footprint_radius_km,
    ring_bearings_deg,
    ring_lonlat,
)
from ..orbit.horizon import HorizonMask
from ..orbit.hpop.propagate import HpopOptions, InitialState
from ..orbit.kepler import osculating_summary
from ..orbit.passes import Observer
from ..orbit.propagation import OrbitSource, Propagation, choose, run
from ..orbit.propagator import (
    Ephemeris,
    PropagationRequestError,
    as_utc,
    orbit_summary,
    timescale,
    tle_lines,
)
from ..orbit.sun import beta_series_deg, planets, sun_unit_itrs
from ..orbit.swath import Sensor, compute_swath, fov_from_swath_km
from .custom_elements import load_custom
from .custom_ephemerides import ephemeris_orbit, load_ephemeris, stored_ephemeris
from .custom_states import load_state, state_arrays, state_epoch, state_spacecraft
from .errors import ApiError
from .schemas import (
    AccessRequest,
    PassSatellite,
    PropagateRequest,
    SatelliteRef,
    SwathRequest,
    TmtcSessionRequest,
    element_summary,
    flat,
    iso,
)

logger = logging.getLogger(__name__)
router = APIRouter()

#: Requests that name a satellite and the start of the span its elements must cover.
SatelliteRequest = PropagateRequest | PassSatellite | AccessRequest | TmtcSessionRequest


async def resolve(request: Request, body: SatelliteRequest) -> ResolvedElements:
    """Elements for the satellite a request names, catalog or user-supplied.

    User elements are used as they are: there is no history to look up for them.
    """
    if body.custom_id is not None:
        return ResolvedElements(load_custom(request, body.custom_id).element_set(), [])
    assert body.norad_id is not None, "a state vector has no elements to resolve"
    gp: GPService = request.app.state.gp
    try:
        return await gp.resolve(body.norad_id, as_utc(body.start))
    except ElementsUnavailable as error:
        raise ApiError.of(404, error) from error


def element_set_of(resolved: ResolvedElements, body: SatelliteRef) -> dict:
    """Element summary a response echoes; ``custom_id`` is null for catalog elements."""
    return {**element_summary(resolved.elements), "custom_id": body.custom_id}


@dataclass(frozen=True)
class ResolvedSource:
    """What a propagation request names, and what the response says about it."""

    source: OrbitSource
    #: ``element_set`` of the response, before the fields that depend on the window.
    summary: dict[str, Any]
    epoch: datetime
    orbit: dict[str, Any]
    tle: tuple[str, str] | None
    omm: dict[str, Any] | None
    warnings: list[dict[str, Any]]


async def resolve_source(request: Request, body: PropagateRequest) -> ResolvedSource:
    """The orbit source of a propagation request: elements, a state, or an ephemeris."""
    if body.ephemeris_id is not None:
        custom = load_ephemeris(request, body.ephemeris_id)
        stored = stored_ephemeris(custom)
        summary = {
            "norad_id": 0,
            "name": custom.name,
            "object_id": stored.object_id,
            "epoch": iso(stored.start),
            "source": "user",
            "custom_id": None,
            "state_id": None,
            "ephemeris_id": custom.id,
            "span_start": iso(stored.start),
            "span_end": iso(stored.stop),
        }
        orbit = ephemeris_orbit(stored)
        source = OrbitSource("oem", ephemeris=stored)
        return ResolvedSource(source, summary, stored.start, orbit, None, None, [])
    if body.state_id is not None:
        custom = load_state(request, body.state_id)
        position, velocity = state_arrays(custom)
        epoch = state_epoch(custom)
        state = InitialState(
            epoch=timescale().from_datetime(epoch),
            position_m=position,
            velocity_m_s=velocity,
            origin="stateVector",
            spacecraft=state_spacecraft(custom),
        )
        summary = {
            "norad_id": 0,
            "name": custom.name,
            "object_id": str(custom.state.get("object_id") or ""),
            "epoch": iso(epoch),
            "source": "user",
            "custom_id": None,
            "state_id": custom.id,
            "ephemeris_id": None,
        }
        orbit = osculating_summary(position, velocity, custom.name)
        return ResolvedSource(
            OrbitSource("opm", state=state), summary, epoch, orbit, None, None, []
        )
    resolved = await resolve(request, body)
    omm = resolved.elements.omm
    return ResolvedSource(
        OrbitSource("omm", omm),
        {**element_set_of(resolved, body), "state_id": None, "ephemeris_id": None},
        resolved.elements.epoch,
        orbit_summary(omm),
        tle_lines(omm),
        omm,
        resolved.warnings,
    )


async def _propagate(
    request: Request, resolved: ResolvedSource, body: PropagateRequest
) -> Propagation:
    source = resolved.source
    try:
        chosen = choose(source.kind, body.propagator)
        options = body.hpop.options() if body.hpop else HpopOptions()
        needs_kernel = chosen == "hpop" and options.needs_bodies
        kernel = await kernel_of(request) if needs_kernel else None
        return await asyncio.to_thread(
            run, source, body.start, body.end, body.step_s, chosen, options, kernel
        )
    except PropagationRequestError as error:
        raise ApiError.of(422, error) from error


async def kernel_of(request: Request) -> SpiceKernel:
    try:
        return await asyncio.to_thread(planets, request.app.state.settings.ephemeris_dir)
    except OSError as error:
        logger.exception("Loading the DE421 ephemeris failed")
        raise ApiError(
            503, "ephemerisUnavailable", "태양 위치 천체력(de421.bsp) 불러오기 실패"
        ) from error


@dataclass(frozen=True)
class SunSeries:
    """What the Sun adds to a propagation response; every field is null without DE421."""

    eclipse_s: list[float] | None
    beta_offset_s: list[float] | None
    beta_deg: list[float] | None
    warnings: list[dict[str, Any]]


async def _sun_series(request: Request, ephemeris: Ephemeris) -> SunSeries:
    """Eclipse intervals and beta angle of a propagation, or nulls with a warning.

    Propagation does not need the Sun, so a missing ephemeris only drops these displays.
    """
    try:
        kernel = await asyncio.to_thread(planets, request.app.state.settings.ephemeris_dir)
    except OSError:
        logger.warning("DE421 ephemeris unavailable; propagating without eclipse intervals")
        warning = message(
            "eclipseUnavailable", "태양 위치 천체력(de421.bsp)이 없어 식(eclipse) 구간 계산 생략"
        )
        return SunSeries(None, None, None, [warning])

    def compute() -> SunSeries:
        sun = sun_unit_itrs(kernel, ephemeris.times)
        intervals = eclipse_intervals_s(ephemeris.fixed_m, sun, ephemeris.valid, ephemeris.step_s)
        beta = beta_series_deg(ephemeris, kernel)
        return SunSeries(
            [round(value, 1) for value in intervals],
            None if beta is None else [round(float(value), 1) for value in beta[0]],
            None if beta is None else [round(float(value), 3) for value in beta[1]],
            [],
        )

    return await asyncio.to_thread(compute)


@router.post("/propagate")
async def propagate_orbit(request: Request, body: PropagateRequest) -> JSONResponse:
    resolved = await resolve_source(request, body)
    propagation = await _propagate(request, resolved, body)
    ephemeris = propagation.ephemeris
    # An ephemeris has a span, not an epoch its accuracy decays from.
    age = (ephemeris.start - resolved.epoch).total_seconds() / 86400
    sun = await _sun_series(request, ephemeris)
    payload: dict[str, Any] = {
        "element_set": {
            **resolved.summary,
            "age_days": None if resolved.source.kind == "oem" else round(age, 3),
            "tle": resolved.tle,
            "omm": resolved.omm,
        },
        "orbit": resolved.orbit,
        "propagator": propagation.propagator,
        "force_model": propagation.force_model,
        "start": iso(ephemeris.start),
        "step_s": ephemeris.step_s,
        "count": len(ephemeris),
        "invalid": [int(i) for i in (~ephemeris.valid).nonzero()[0]],
        "fixed_m": flat(ephemeris.fixed_m, 1),
        "inertial_m": flat(ephemeris.inertial_m, 1),
        "lat_deg": flat(ephemeris.lat_deg, 5),
        "lon_deg": flat(ephemeris.lon_deg, 5),
        "alt_km": flat(ephemeris.alt_km, 3),
        "eclipse_s": sun.eclipse_s,
        "beta_offset_s": sun.beta_offset_s,
        "beta_deg": sun.beta_deg,
        "warnings": resolved.warnings + ephemeris.warnings + sun.warnings,
    }
    return JSONResponse(payload)


@router.post("/swath")
async def swath(request: Request, body: SwathRequest) -> JSONResponse:
    resolved = await resolve_source(request, body)
    ephemeris = (await _propagate(request, resolved, body)).ephemeris
    kernel = await kernel_of(request)
    sensor = body.sensor
    valid_alt = ephemeris.alt_km[ephemeris.valid]
    fov = sensor.fov_deg
    if fov is None:
        assert sensor.swath_km is not None
        fov = fov_from_swath_km(sensor.swath_km, float(valid_alt.mean()) if valid_alt.size else 0)

    def compute():
        sun = sun_unit_itrs(kernel, ephemeris.times)
        return compute_swath(
            ephemeris, Sensor(fov, sensor.max_off_nadir_deg, sensor.min_sun_elev_deg), sun
        )

    result = await asyncio.to_thread(compute)
    return JSONResponse(
        {
            "fov_deg": result.fov_deg,
            "nadir_width_km": result.nadir_width_km,
            "for_width_km": result.for_width_km,
            "daylight_fraction": result.daylight_fraction,
            "segments": [
                {
                    "kind": segment.kind,
                    "daylight": segment.daylight,
                    "i0": segment.i0,
                    "i1": segment.i1,
                    "left": flat(segment.left, 5),
                    "right": flat(segment.right, 5),
                }
                for segment in result.segments
            ],
            "warnings": resolved.warnings + ephemeris.warnings,
        }
    )


def visibility(station: Station, mean_alt_km: float, min_elev_deg: float) -> dict:
    """Outline of where a subpoint has to be for this station to see the satellite.

    With a mask the required elevation, and therefore the radius, changes with azimuth, so
    the ring becomes a lobed outline instead of a circle. ``radius_km`` stays the easiest
    case to quote: the widest reach, at the lowest elevation the station accepts.
    """
    mask = HorizonMask.from_points(station.az_mask)
    if mask is None:
        radius = footprint_radius_km(mean_alt_km, min_elev_deg)
        return {
            "radius_km": radius,
            "max_radius_km": radius,
            "ring": circle_lonlat(station.lat_deg, station.lon_deg, radius),
        }
    needed = np.maximum(min_elev_deg, mask.elevation_at(ring_bearings_deg()))
    radii = footprint_radii_km(mean_alt_km, needed)
    return {
        "radius_km": float(radii.max()),
        "max_radius_km": float(radii.max()),
        "ring": ring_lonlat(station.lat_deg, station.lon_deg, radii),
    }


def stations_of(request: Request, station_ids: list[int]) -> list[Station]:
    """Stations by id, in the given order.

    Raises:
        ApiError: 404 ``stationNotFound`` listing every unknown id.
    """
    store = request.app.state.gp.store
    stations = [(station_id, store.station(station_id)) for station_id in station_ids]
    unknown = [station_id for station_id, station in stations if station is None]
    if unknown:
        raise ApiError(404, "stationNotFound", "지상국 없음", ids=unknown)
    return [station for _, station in stations if station is not None]


def observer_of(station: Station, min_elev_deg: float) -> Observer:
    """Pass search observer for a station, with its horizon mask."""
    return Observer(
        station.lat_deg,
        station.lon_deg,
        station.alt_m,
        min_elev_deg,
        HorizonMask.from_points(station.az_mask),
    )
