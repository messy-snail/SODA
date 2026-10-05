"""Power budget endpoint."""

import asyncio
from datetime import datetime, timedelta

import numpy as np
from fastapi import APIRouter, Request

from ..errors import message
from ..orbit.battery import BatteryCurveError
from ..orbit.power import (
    COARSE_STEP_S,
    Contact,
    PowerRequestError,
    Shot,
    beta_deg,
    kernel_sun,
    simulate_power,
    span_s,
)
from ..orbit.power_geometry import station_ecef
from ..orbit.propagator import as_utc
from .errors import ApiError
from .orbit import _propagate, kernel_of, resolve_source, stations_of
from .schemas import PowerRequest, flat, iso

router = APIRouter()


def _seconds(values: list[float]) -> list[float]:
    return [round(value, 1) for value in values]


def _optional(values: np.ndarray | None, decimals: int) -> list[float] | None:
    return None if values is None else flat(values, decimals)


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 3)


@router.post("/power")
async def power(request: Request, body: PowerRequest) -> dict:
    """Stored energy of the battery over the run, with the activities the client planned."""
    resolved = await resolve_source(request, body)
    ephemeris = (await _propagate(request, resolved, body)).ephemeris
    kernel = await kernel_of(request)
    try:
        spec = body.power.spec()
    except BatteryCurveError as error:
        raise ApiError.of(422, error) from error

    def offset(value: datetime) -> float:
        return (as_utc(value) - as_utc(ephemeris.start)).total_seconds()

    stations = {}
    if spec.contact_attitude == "station":
        ids = list(dict.fromkeys(contact.station_id for contact in body.contacts))
        stations = {
            station.id: station_ecef(station.lat_deg, station.lon_deg, station.alt_m)
            for station in stations_of(request, ids)
        }
    shots = [
        Shot(offset(shot.start), offset(shot.end), shot.roll_deg, shot.pitch_deg)
        for shot in body.shots
    ]
    contacts = [
        Contact(
            offset(contact.start),
            offset(contact.end),
            contact.downlink,
            stations.get(contact.station_id),
        )
        for contact in body.contacts
    ]

    begin_s = 0.0 if body.soc_at is None else offset(body.soc_at)

    def compute():
        sun = kernel_sun(kernel, ephemeris.start)
        result = simulate_power(ephemeris, sun, spec, shots, contacts, begin_s)
        return result, beta_deg(ephemeris, kernel)

    try:
        result, beta = await asyncio.to_thread(compute)
    except PowerRequestError as error:
        raise ApiError.of(422, error) from error

    span = span_s(ephemeris)
    warnings = resolved.warnings + ephemeris.warnings
    if result.off_sun_s > 0 and ephemeris.step_s > COARSE_STEP_S:
        warnings = warnings + [
            message(
                "powerCoarseStep",
                f"전파 간격이 {COARSE_STEP_S:.0f}초보다 커서 촬영·교신 중 발전량이 부정확",
                step_s=ephemeris.step_s,
                max_s=COARSE_STEP_S,
            )
        ]
    eclipse_total = sum(result.eclipse_s[1::2]) - sum(result.eclipse_s[0::2])
    return {
        "start": iso(ephemeris.start),
        "span_s": span,
        "soc_at": iso(as_utc(ephemeris.start) + timedelta(seconds=begin_s)),
        "model": "energy" if spec.battery is None else "circuit",
        "capacity_wh": round(result.capacity_wh, 3),
        "time_s": flat(result.time_s, 1),
        "soc": flat(result.soc, 5),
        "voltage_v": _optional(result.voltage_v, 3),
        "current_a": _optional(result.current_a, 3),
        "generated_wh": round(result.generated_wh, 3),
        "consumed_wh": round(result.consumed_wh, 3),
        "shunted_wh": round(result.shunted_wh, 3),
        "unmet_wh": round(result.unmet_wh, 3),
        "loss_wh": _rounded(result.loss_wh),
        "min_voltage_v": _rounded(result.min_voltage_v),
        "max_voltage_v": _rounded(result.max_voltage_v),
        "max_discharge_a": _rounded(result.max_discharge_a),
        "max_charge_a": _rounded(result.max_charge_a),
        "min_soc": round(result.min_soc, 5),
        "max_dod": round(1 - result.min_soc, 5),
        "final_soc": round(result.final_soc, 5),
        "below_limit_s": _seconds(result.below_limit_s),
        "empty_s": _seconds(result.empty_s),
        "eclipse_s": _seconds(result.eclipse_s),
        "eclipse_fraction": round(eclipse_total / span, 5) if span > 0 else 0.0,
        "off_sun_s": round(result.off_sun_s, 1),
        "beta_start_deg": None if beta is None else round(beta[0], 3),
        "beta_end_deg": None if beta is None else round(beta[1], 3),
        "warnings": warnings,
    }
