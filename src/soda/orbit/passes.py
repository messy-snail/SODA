"""Pass prediction over a ground station with Skyfield event search.

Skyfield's ``find_events`` only takes one elevation threshold, so a station with a horizon
mask is handled in two stages: search at the mask's lowest elevation to get candidate
windows that cannot miss anything, then split each window where the satellite drops under
the elevation the mask requires at its current azimuth.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from skyfield.api import wgs84
from skyfield.framelib import itrs
from skyfield.jpllib import SpiceKernel
from skyfield.timelib import Time

from .horizon import HorizonMask
from .propagator import PropagationRequestError, as_utc, satellite_from_omm, timescale

MAX_PASS_WINDOW = timedelta(days=30)
MAX_STATIONS = 8
TWILIGHT_SUN_ALT_DEG = -6.0

DAY_S = 86_400.0
#: Base spacing of the mask sampling grid. Azimuth moves under 0.25 deg/s on a typical LEO
#: pass, so four seconds stays well inside ``MAX_AZ_STEP_DEG`` except around culmination.
SAMPLE_STEP_S = 4.0
MIN_SAMPLES_PER_WINDOW = 24
#: Extra samples are inserted until neighbours are this close in azimuth, so a narrow
#: notch in the mask cannot fall between two grid points.
MAX_AZ_STEP_DEG = 1.0
SAMPLE_GROWTH_LIMIT = 4
#: Halving a four second bracket twelve times lands within a millisecond.
BISECTION_STEPS = 12
#: Segments shorter than this are numerical noise around a grazing mask edge.
MIN_SEGMENT_S = 1.0
#: ``find_events`` returns endpoints sitting exactly on the threshold; without slack they
#: can compare below a mask that requires the very same elevation.
ELEV_TOLERANCE_DEG = 1e-4
#: Spacing of the Earth-fixed track sent with each pass for drawing it on the globe.
TRACK_STEP_S = 10.0
#: Upper bound on track points per pass, so a long geostationary contact stays small.
MAX_TRACK_POINTS = 400
#: The event search reaches this far past both ends of the requested window, so a pass
#: already in progress at the start (or still running at the end) keeps its real AOS and
#: LOS instead of being cut at the window edge. Longer contacts, such as MEO or GEO, are
#: still clipped at the widened bounds and flagged ``clipped_start``/``clipped_end``.
EDGE_LOOKAROUND = timedelta(minutes=30)


@dataclass(frozen=True)
class Observer:
    """A station: where it is, how low it will look, and what blocks its horizon."""

    lat_deg: float
    lon_deg: float
    alt_m: float
    min_elev_deg: float = 10.0
    mask: HorizonMask | None = None


@dataclass
class _Window:
    """One above-threshold interval, before or after mask splitting."""

    aos: Time
    tca: Time | None
    los: Time
    clipped_start: bool
    clipped_end: bool
    index: int
    mask_limited: bool = False


@dataclass
class _Bracket:
    """A sign change of ``elevation - required`` waiting to be refined."""

    lo: float
    hi: float
    rising: bool
    segment: int
    start: bool


def find_passes(
    omm: dict[str, Any],
    observer: Observer,
    start: datetime,
    end: datetime,
    kernel: SpiceKernel,
) -> list[dict[str, Any]]:
    """Passes clearing ``observer.min_elev_deg`` and ``observer.mask`` between the bounds.

    Passes already in progress at ``start`` or still running at ``end`` keep their real
    AOS and LOS (searched up to ``EDGE_LOOKAROUND`` beyond the window) and are flagged
    ``partial``. Only contacts longer than that are clipped, which ``clipped_start`` and
    ``clipped_end`` report.
    """
    return find_passes_multi(omm, [observer], start, end, kernel)[0]


def find_passes_multi(
    omm: dict[str, Any],
    observers: Sequence[Observer],
    start: datetime,
    end: datetime,
    kernel: SpiceKernel,
) -> list[list[dict[str, Any]]]:
    """Passes for several stations, in the order the observers were given.

    The satellite, the timescale, and the ephemeris are built once and shared, which is why
    stations are batched here instead of by repeated ``find_passes`` calls.

    Raises:
        PropagationRequestError: Window or station count is outside the supported limits.
    """
    start, end = as_utc(start), as_utc(end)
    if end <= start:
        raise PropagationRequestError("endBeforeStart", "종료 시각은 시작 시각보다 늦어야 함")
    if end - start > MAX_PASS_WINDOW:
        raise PropagationRequestError(
            "passWindowTooLong",
            f"패스 예측 기간은 최대 {MAX_PASS_WINDOW.days}일",
            days=MAX_PASS_WINDOW.days,
        )
    if not observers:
        raise PropagationRequestError("noStationSelected", "지상국을 하나 이상 선택 필요")
    if len(observers) > MAX_STATIONS:
        raise PropagationRequestError(
            "tooManyStations",
            f"지상국은 한 번에 최대 {MAX_STATIONS}곳까지 계산 가능",
            max=MAX_STATIONS,
        )

    ts = timescale()
    satellite = satellite_from_omm(omm)
    t0, t1 = ts.from_datetime(start), ts.from_datetime(end)
    wide0 = ts.from_datetime(start - EDGE_LOOKAROUND)
    wide1 = ts.from_datetime(end + EDGE_LOOKAROUND)

    results: list[list[dict[str, Any]]] = []
    for observer in observers:
        topos = wgs84.latlon(observer.lat_deg, observer.lon_deg, elevation_m=observer.alt_m)
        mask, minimum = observer.mask, observer.min_elev_deg
        floor = minimum if mask is None else max(minimum, mask.floor_deg)
        windows = _event_windows(satellite, topos, wide0, wide1, floor)
        windows = _overlapping(windows, t0, t1)
        if mask is not None:
            windows = _overlapping(_split_by_mask(satellite, topos, windows, mask, minimum), t0, t1)
        results.append(_describe(windows, satellite, topos, kernel, t0, t1))
    return results


def _event_windows(
    satellite: Any, topos: Any, t0: Time, t1: Time, altitude_deg: float
) -> list[_Window]:
    """Rise/culminate/set triples from Skyfield, clipped to the searched span."""
    times, events = satellite.find_events(topos, t0, t1, altitude_degrees=altitude_deg)
    windows: list[_Window] = []
    aos: Time | None = None
    tca: Time | None = None
    clipped_start = False
    open_window = False
    for t, event in zip(times, events, strict=True):
        if event == 0:
            aos, tca, clipped_start, open_window = t, None, False, True
        else:
            if not open_window:
                aos, tca, clipped_start, open_window = t0, None, True, True
            if event == 1:
                tca = t
            else:
                windows.append(
                    _Window(
                        aos=aos,
                        tca=tca,
                        los=t,
                        clipped_start=clipped_start,
                        clipped_end=False,
                        index=len(windows),
                    )
                )
                open_window = False
    if open_window:
        windows.append(
            _Window(
                aos=aos,
                tca=tca,
                los=t1,
                clipped_start=clipped_start,
                clipped_end=True,
                index=len(windows),
            )
        )
    return windows


def _overlapping(windows: Sequence[_Window], t0: Time, t1: Time) -> list[_Window]:
    """Windows that share some time with ``[t0, t1]``, numbered in order of appearance.

    Numbering happens after the cut so a contact found only in the look-around margin
    does not shift the indices of the passes the user asked about. Mask segments of one
    window share its index, so equal indices stay equal.
    """
    kept = [w for w in windows if w.los.tt > t0.tt and w.aos.tt < t1.tt]
    renumber: dict[int, int] = {}
    for window in kept:
        window.index = renumber.setdefault(window.index, len(renumber))
    return kept


def _describe(
    windows: Sequence[_Window],
    satellite: Any,
    topos: Any,
    kernel: SpiceKernel,
    t0: Time,
    t1: Time,
) -> list[dict[str, Any]]:
    """Turn windows into the response records, including lighting at culmination."""
    difference = satellite - topos
    observer_at = kernel["earth"] + topos
    passes = []
    for window in windows:
        tca = window.aos if window.tca is None else window.tca
        _, aos_az, _ = difference.at(window.aos).altaz()
        tca_alt, tca_az, tca_range = difference.at(tca).altaz()
        _, los_az, _ = difference.at(window.los).altaz()
        sunlit = bool(satellite.at(tca).is_sunlit(kernel))
        sun_alt = observer_at.at(tca).observe(kernel["sun"]).apparent().altaz()[0].degrees
        passes.append(
            {
                "aos": window.aos.utc_datetime(),
                "tca": tca.utc_datetime(),
                "los": window.los.utc_datetime(),
                "duration_s": (window.los - window.aos) * DAY_S,
                "max_elevation_deg": float(tca_alt.degrees),
                "tca_range_km": float(tca_range.km),
                "aos_azimuth_deg": float(aos_az.degrees),
                "tca_azimuth_deg": float(tca_az.degrees),
                "los_azimuth_deg": float(los_az.degrees),
                "satellite_sunlit": sunlit,
                "observer_sun_alt_deg": float(sun_alt),
                "visible": bool(sunlit and sun_alt < TWILIGHT_SUN_ALT_DEG),
                "partial": bool(window.aos.tt < t0.tt or window.los.tt > t1.tt),
                "clipped_start": window.clipped_start,
                "clipped_end": window.clipped_end,
                "pass_index": window.index,
                "mask_limited": window.mask_limited,
                "track_fixed_m": _track_fixed_m(satellite, window),
            }
        )
    return passes


def _track_fixed_m(satellite: Any, window: _Window) -> list[float]:
    """Flat ITRS positions ``[x0, y0, z0, ...]`` from AOS to LOS inclusive, evenly spaced.

    Args:
        satellite: Skyfield satellite for the pass.
        window: The contact to sample.

    Returns:
        Metres in the Earth-fixed frame; empty if SGP4 fails anywhere on the pass.
    """
    span_s = (window.los.tt - window.aos.tt) * DAY_S
    count = int(np.clip(np.ceil(span_s / TRACK_STEP_S), 1, MAX_TRACK_POINTS - 1)) + 1
    ts = window.aos.ts
    t = ts.tt_jd(np.linspace(window.aos.tt, window.los.tt, count))
    fixed_m = satellite.at(t).frame_xyz(itrs).m.T
    if not np.isfinite(fixed_m).all():
        return []
    return [round(float(value), 1) for value in fixed_m.ravel()]


def _base_grid(window: _Window) -> np.ndarray:
    """Regular TT julian dates covering one candidate window."""
    span_s = (window.los.tt - window.aos.tt) * DAY_S
    count = max(MIN_SAMPLES_PER_WINDOW, int(np.ceil(span_s / SAMPLE_STEP_S))) + 1
    return np.linspace(window.aos.tt, window.los.tt, count)


def _azimuth_infill(jd: np.ndarray, az_deg: np.ndarray) -> np.ndarray:
    """Extra sample times wherever the azimuth moves more than ``MAX_AZ_STEP_DEG``."""
    steps = np.abs((np.diff(az_deg) + 180.0) % 360.0 - 180.0)
    extra = [
        np.linspace(jd[i], jd[i + 1], int(np.ceil(gap / MAX_AZ_STEP_DEG)) + 1)[1:-1]
        for i, gap in enumerate(steps)
        if gap > MAX_AZ_STEP_DEG
    ]
    if not extra:
        return np.empty(0)
    out = np.unique(np.concatenate(extra))
    limit = SAMPLE_GROWTH_LIMIT * jd.size
    if out.size > limit:
        out = out[np.unique(np.linspace(0, out.size - 1, limit).astype(int))]
    return out


def _runs(flags: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive index bounds of each contiguous ``True`` run."""
    idx = np.flatnonzero(flags)
    if idx.size == 0:
        return []
    breaks = np.flatnonzero(np.diff(idx) > 1)
    starts = np.concatenate(([idx[0]], idx[breaks + 1]))
    ends = np.concatenate((idx[breaks], [idx[-1]]))
    return [(int(a), int(b)) for a, b in zip(starts, ends, strict=True)]


def _peak_jd(jd: np.ndarray, alt_deg: np.ndarray, i0: int, i1: int) -> float:
    """Culmination estimate inside one segment, refined by a parabola through the grid."""
    k = i0 + int(np.argmax(alt_deg[i0 : i1 + 1]))
    if k <= i0 or k >= i1:
        return float(jd[k])
    t = (jd[k - 1 : k + 2] - jd[k]) * DAY_S
    a = alt_deg[k - 1 : k + 2]
    denom = (t[0] - t[1]) * (t[0] - t[2]) * (t[1] - t[2])
    if denom == 0.0:
        return float(jd[k])
    quad = (t[2] * (a[1] - a[0]) + t[1] * (a[0] - a[2]) + t[0] * (a[2] - a[1])) / denom
    lin = (
        t[2] ** 2 * (a[0] - a[1]) + t[1] ** 2 * (a[2] - a[0]) + t[0] ** 2 * (a[1] - a[2])
    ) / denom
    if quad >= 0.0:
        return float(jd[k])
    vertex = -lin / (2.0 * quad)
    if not t[0] <= vertex <= t[2]:
        return float(jd[k])
    return float(jd[k] + vertex / DAY_S)


def _split_by_mask(
    satellite: Any,
    topos: Any,
    windows: Sequence[_Window],
    mask: HorizonMask,
    min_elevation_deg: float,
) -> list[_Window]:
    """Cut each candidate window down to the parts that clear the mask."""
    if not windows:
        return []
    ts = timescale()
    difference = satellite - topos

    def sample(jd: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if jd.size == 0:
            return np.empty(0), np.empty(0)
        alt, az, _ = difference.at(ts.tt_jd(jd)).altaz()
        return np.atleast_1d(alt.degrees), np.atleast_1d(az.degrees)

    def required(az_deg: np.ndarray) -> np.ndarray:
        return np.maximum(min_elevation_deg, mask.elevation_at(az_deg))

    grids = [_base_grid(window) for window in windows]
    bounds = np.cumsum([0, *(grid.size for grid in grids)])
    jd = np.concatenate(grids)
    alt, az = sample(jd)

    infill = [
        _azimuth_infill(jd[bounds[i] : bounds[i + 1]], az[bounds[i] : bounds[i + 1]])
        for i in range(len(windows))
    ]
    extra = np.concatenate(infill)
    extra_alt, extra_az = sample(extra)

    tracks: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    cursor = 0
    for i in range(len(windows)):
        lo, hi = bounds[i], bounds[i + 1]
        count = infill[i].size
        merged_jd = np.concatenate([jd[lo:hi], extra[cursor : cursor + count]])
        merged_alt = np.concatenate([alt[lo:hi], extra_alt[cursor : cursor + count]])
        merged_az = np.concatenate([az[lo:hi], extra_az[cursor : cursor + count]])
        cursor += count
        order = np.argsort(merged_jd)
        tracks.append((merged_jd[order], merged_alt[order], merged_az[order]))

    segments: list[dict[str, Any]] = []
    brackets: list[_Bracket] = []
    for window, (track_jd, track_alt, track_az) in zip(windows, tracks, strict=True):
        needed = required(track_az)
        above = track_alt >= needed - ELEV_TOLERANCE_DEG
        last = track_jd.size - 1
        for i0, i1 in _runs(above):
            index = len(segments)
            if i0 > 0:
                brackets.append(_Bracket(track_jd[i0 - 1], track_jd[i0], True, index, True))
            if i1 < last:
                brackets.append(_Bracket(track_jd[i1], track_jd[i1 + 1], False, index, False))
            segments.append(
                {
                    "window": window,
                    "start_jd": float(track_jd[i0]),
                    "end_jd": float(track_jd[i1]),
                    "peak_jd": _peak_jd(track_jd, track_alt, i0, i1),
                    "clipped_start": window.clipped_start and i0 == 0,
                    "clipped_end": window.clipped_end and i1 == last,
                    # Judged from the requirement itself, not from the grid: bisection is
                    # finer than ``find_events``, so even an unlimiting mask moves a
                    # boundary by a fraction of a second.
                    "mask_limited": bool(
                        needed[[i0, i1]].max() > min_elevation_deg + ELEV_TOLERANCE_DEG
                    ),
                }
            )

    for bracket, crossing in zip(brackets, _refine(brackets, sample, required), strict=True):
        segments[bracket.segment]["start_jd" if bracket.start else "end_jd"] = crossing

    kept = [
        segment
        for segment in segments
        if (segment["end_jd"] - segment["start_jd"]) * DAY_S >= MIN_SEGMENT_S
    ]
    return [_segment_window(segment, ts) for segment in kept]


def _refine(
    brackets: Sequence[_Bracket],
    sample: Any,
    required: Any,
) -> list[float]:
    """Bisect every mask crossing at once.

    ``elevation - required`` bends at each mask vertex, so a secant step can leave the
    bracket. Bisection only needs the sign, which that kink cannot upset.
    """
    if not brackets:
        return []
    lo = np.array([bracket.lo for bracket in brackets], dtype=float)
    hi = np.array([bracket.hi for bracket in brackets], dtype=float)
    rising = np.array([bracket.rising for bracket in brackets], dtype=bool)
    for _ in range(BISECTION_STEPS):
        mid = 0.5 * (lo + hi)
        mid_alt, mid_az = sample(mid)
        above = mid_alt >= required(mid_az) - ELEV_TOLERANCE_DEG
        move_hi = np.where(rising, above, ~above)
        lo = np.where(move_hi, lo, mid)
        hi = np.where(move_hi, mid, hi)
    return [float(value) for value in 0.5 * (lo + hi)]


def _segment_window(segment: dict[str, Any], ts: Any) -> _Window:
    """Rebuild a window from a refined segment, keeping the culmination inside it."""
    window: _Window = segment["window"]
    start, end = segment["start_jd"], segment["end_jd"]
    parent = window.tca
    peak = segment["peak_jd"]
    if parent is not None and start <= parent.tt <= end:
        peak = parent.tt
    return _Window(
        aos=ts.tt_jd(start),
        tca=ts.tt_jd(min(max(peak, start), end)),
        los=ts.tt_jd(end),
        clipped_start=segment["clipped_start"],
        clipped_end=segment["clipped_end"],
        index=window.index,
        mask_limited=segment["mask_limited"],
    )
