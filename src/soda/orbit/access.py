"""Imaging opportunities: when a satellite can point its sensor at ground targets.

Two pointing models (see ``access_geometry.Pointing``):

- ``roll``: the sensor only rolls, so a point is imaged at the instant the cross-track
  plane passes over it (pitch 0), if ``|roll| <= max_roll + fov/2`` there. Its window is
  that instant. A box is imaged while the cross-track arc within roll reach crosses it,
  so its window is the time the strip takes to sweep the box.
- ``roll_pitch``: the sensor can also pitch, so a window lasts while ``|roll| <=
  max_roll + fov/2`` and ``|pitch| <= max_pitch``. The best moment is the one closest to
  pitch 0. A box is aimed at its point nearest the subpoint, so any part of it counts.

In both, the target must be above the satellite's horizon with the Sun at least
``min_sun_elev_deg`` above it. Half the field of view widens the roll reach because a
target at the image edge is still imaged. ``coverage`` is the share of a 5 x 5 grid over a
box that is imaged. Windows are found on a 15 s grid and refined by bisection, so a
grazing window shorter than that can be missed.

Each target also gets a diagnosis (``_Search.diagnose``): how many times the satellite
passed with the target's centre within roll reach, and how many of those were too dark. It
is what tells "never in reach" from "in reach, but at night".
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from skyfield.jpllib import SpiceKernel

from ..errors import CodedError
from .access_geometry import (
    Pointing,
    State,
    central_angle_deg,
    cross_track_arc,
    geometry,
    in_box,
    state_at,
    surface_ecef,
    within_reach,
    wrap_lon,
)
from .access_strip import strips_for
from .propagator import as_utc, satellite_from_omm
from .swath import geodetic_normals

#: Same as the propagation limit, so a whole propagated run can be searched.
MAX_ACCESS_WINDOW = timedelta(days=30)
MAX_TARGETS = 20
#: Coarse grid spacing. A 500 km orbit crosses a 30 degree cone in about a minute.
ACCESS_STEP_S = 15.0
#: Halving a 15 s bracket six times lands within a quarter second.
EDGE_STEPS = 6
#: Halving a 15 s bracket fourteen times lands within a millisecond.
CROSSING_STEPS = 14
#: Ternary search on a 30 s bracket; 16 rounds leave about 50 ms.
BEST_STEPS = 16
#: Coverage grid per box side.
COVERAGE_GRID = 5
#: Ground points sampled along the cross-track arc of the roll-only model.
ARC_POINTS = 41
#: Sampling of a roll-only box sweep, for the coverage grid's crossing times.
SWEEP_STEP_S = 1.0
MAX_SWEEP_SAMPLES = 2000


class AccessRequestError(CodedError, ValueError):
    """The requested window or target list is outside the supported limits."""


@dataclass(frozen=True)
class Target:
    """A ground point, or a longitude/latitude box when ``box_deg`` is set.

    Attributes:
        id: Caller's identifier, echoed in the result.
        lat_deg: Centre latitude.
        lon_deg: Centre longitude.
        box_deg: ``(west, south, east, north)``; ``east < west`` crosses the date line.
    """

    id: str
    lat_deg: float
    lon_deg: float
    box_deg: tuple[float, float, float, float] | None = None

    @classmethod
    def point(cls, target_id: str, lat_deg: float, lon_deg: float) -> "Target":
        return cls(target_id, lat_deg, lon_deg)

    @classmethod
    def box(
        cls, target_id: str, west_deg: float, south_deg: float, east_deg: float, north_deg: float
    ) -> "Target":
        width = (east_deg - west_deg) % 360.0
        center_lon = float(wrap_lon(west_deg + width / 2))
        return cls(
            target_id,
            (south_deg + north_deg) / 2,
            center_lon,
            (west_deg, south_deg, east_deg, north_deg),
        )

    @property
    def center(self) -> np.ndarray:
        return np.array([[self.lat_deg, self.lon_deg]])

    def aim_deg(self, sub_lat: np.ndarray, sub_lon: np.ndarray) -> np.ndarray:
        """``(N, 2)`` ``(lat, lon)`` of the box point nearest each subpoint (clamped)."""
        if self.box_deg is None:
            return np.tile([self.lat_deg, self.lon_deg], (len(sub_lat), 1))
        west, south, east, north = self.box_deg
        width = (east - west) % 360.0
        offset = (sub_lon - west) % 360.0
        past_east, before_west = offset - width, 360.0 - offset
        clamped = np.where(past_east < before_west, east, west)
        lon = np.where(offset <= width, sub_lon, clamped)
        return np.column_stack((np.clip(sub_lat, south, north), wrap_lon(lon)))

    def grid_deg(self) -> np.ndarray:
        """``(P, 2)`` points the coverage share is counted over; a point is its own grid."""
        if self.box_deg is None:
            return self.center
        west, south, east, north = self.box_deg
        width = (east - west) % 360.0
        lats = np.linspace(south, north, COVERAGE_GRID)
        lons = wrap_lon(west + np.linspace(0.0, width, COVERAGE_GRID))
        lat, lon = np.meshgrid(lats, lons, indexing="ij")
        return np.column_stack((lat.ravel(), lon.ravel()))


@dataclass
class _Window:
    owner: int
    begin_s: float
    finish_s: float
    best_s: float
    clipped_start: bool
    clipped_end: bool
    record: dict[str, Any]


def _check(targets: Sequence[Target], start: datetime, end: datetime) -> None:
    if end <= start:
        raise AccessRequestError("endBeforeStart", "종료 시각은 시작 시각보다 늦어야 함")
    if end - start > MAX_ACCESS_WINDOW:
        raise AccessRequestError(
            "accessWindowTooLong",
            f"촬영 기회 계산 기간은 최대 {MAX_ACCESS_WINDOW.days}일",
            days=MAX_ACCESS_WINDOW.days,
        )
    if not targets:
        raise AccessRequestError("noTargetSelected", "촬영 대상을 하나 이상 지정 필요")
    if len(targets) > MAX_TARGETS:
        raise AccessRequestError(
            "tooManyTargets", f"촬영 대상은 한 번에 최대 {MAX_TARGETS}개", max=MAX_TARGETS
        )


@dataclass(frozen=True)
class AccessReport:
    """Windows and a diagnosis for each target, in the order the targets were given.

    Attributes:
        windows: Imaging windows per target.
        diagnosis: Per target, ``passes`` (centre within roll reach and in view), ``dark``
            (those without enough Sun), ``best_sun_elev_deg`` (highest Sun among the dark
            ones, or None) and ``nearest_roll_deg`` (smallest roll any pass needed, or None
            when the satellite never passed with the target in view).
    """

    windows: list[list[dict[str, Any]]]
    diagnosis: list[dict[str, Any]]


def find_access(
    omm: dict[str, Any],
    targets: Sequence[Target],
    start: datetime,
    end: datetime,
    pointing: Pointing,
    kernel: SpiceKernel,
    shot_s: float = 10.0,
) -> list[list[dict[str, Any]]]:
    """Imaging windows for each target, in the order the targets were given.

    Args:
        omm: Normalized OMM fields.
        targets: Ground targets.
        start: Window start (naive values are UTC).
        end: Window end.
        pointing: Pointing model, limits and lighting.
        kernel: DE421 for the Sun direction.
        shot_s: Length of one acquisition, for the strip each window draws.

    Raises:
        AccessRequestError: Window or target count is outside the supported limits.
    """
    return access_report(omm, targets, start, end, pointing, kernel, shot_s).windows


def access_report(
    omm: dict[str, Any],
    targets: Sequence[Target],
    start: datetime,
    end: datetime,
    pointing: Pointing,
    kernel: SpiceKernel,
    shot_s: float = 10.0,
) -> AccessReport:
    """Imaging windows for each target, and why a target has as few as it has.

    Takes the arguments of ``find_access`` and raises the same errors.
    """
    start, end = as_utc(start), as_utc(end)
    _check(targets, start, end)
    span_s = (end - start).total_seconds()
    offsets = np.linspace(0.0, span_s, int(np.ceil(span_s / ACCESS_STEP_S)) + 1)
    satellite = satellite_from_omm(omm)

    def at(times: np.ndarray) -> State:
        return state_at(satellite, kernel, start, times)

    coarse = at(offsets)
    search = _Search(targets, pointing, offsets, coarse, at)
    if pointing.mode == "roll_pitch":
        windows = search.roll_pitch(range(len(targets)))
    else:
        points = [i for i, t in enumerate(targets) if t.box_deg is None]
        boxes = [i for i, t in enumerate(targets) if t.box_deg is not None]
        windows = search.roll_points(points) + search.roll_boxes(boxes)

    strips_for(windows, targets, pointing, shot_s, at)
    results: list[list[dict[str, Any]]] = [[] for _ in targets]
    for window in sorted(windows, key=lambda w: w.best_s):
        shot = {
            "shot_start": start + timedelta(seconds=window.record.pop("shot_start_s")),
            "shot_end": start + timedelta(seconds=window.record.pop("shot_end_s")),
        }
        results[window.owner].append(
            {
                "start": start + timedelta(seconds=window.begin_s),
                "end": start + timedelta(seconds=window.finish_s),
                "best_time": start + timedelta(seconds=float(window.best_s)),
                "duration_s": window.finish_s - window.begin_s,
                **window.record,
                **shot,
                "clipped_start": window.clipped_start,
                "clipped_end": window.clipped_end,
            }
        )
    return AccessReport(results, [search.diagnose(owner) for owner in range(len(targets))])


def _true_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive index ranges where ``mask`` is true."""
    padded = np.concatenate(([False], mask, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(a), int(b) - 1) for a, b in zip(edges[::2], edges[1::2], strict=True)]


def _ascending(state: State) -> bool:
    up, velocity = state.up[0], state.velocity_m_s[0]
    return bool(velocity.dot(np.array([0.0, 0.0, 1.0]) - up[2] * up) > 0)


def _sun_elev_deg(sin_sun: np.ndarray) -> float:
    return float(np.degrees(np.arcsin(np.clip(sin_sun[0], -1, 1))))


@dataclass
class _Search:
    targets: Sequence[Target]
    pointing: Pointing
    offsets: np.ndarray
    coarse: State
    at: Callable[[np.ndarray], State]

    @property
    def last(self) -> int:
        return len(self.offsets) - 1

    def _refine(
        self,
        edges: list[tuple[int, int]],
        rising: bool,
        accessible: Callable[[np.ndarray, np.ndarray], np.ndarray],
    ) -> dict[tuple[int, int], float]:
        """Edge times by bisection between the grid sample outside and the one inside."""
        if not edges:
            return {}
        owners = np.array([owner for owner, _ in edges])
        inside = np.array([index for _, index in edges])
        outside = inside - 1 if rising else inside + 1
        lo, hi = self.offsets[outside].copy(), self.offsets[inside].copy()
        for _ in range(EDGE_STEPS):
            mid = (lo + hi) / 2
            ok = accessible(mid, owners)
            hi = np.where(ok, mid, hi)
            lo = np.where(ok, lo, mid)
        return {key: float(value) for key, value in zip(edges, (lo + hi) / 2, strict=True)}

    def _spans(
        self,
        runs: list[tuple[int, int, int]],
        accessible: Callable[[np.ndarray, np.ndarray], np.ndarray],
    ) -> list[tuple[int, int, int, float, float]]:
        """Runs of grid samples turned into refined ``(owner, a, b, begin, finish)``."""
        span_s = float(self.offsets[-1])
        rise = self._refine([(o, a) for o, a, _ in runs if a > 0], True, accessible)
        fall = self._refine([(o, b) for o, _, b in runs if b < self.last], False, accessible)
        return [
            (o, a, b, 0.0 if a == 0 else rise[(o, a)], span_s if b == self.last else fall[(o, b)])
            for o, a, b in runs
        ]

    def _per_owner(
        self, test: Callable[[State, Target], np.ndarray]
    ) -> Callable[[np.ndarray, np.ndarray], np.ndarray]:
        """Lift a per-target test to rows whose target is ``targets[owners[i]]``."""

        def accessible(times: np.ndarray, owners: np.ndarray) -> np.ndarray:
            state = self.at(times)
            result = np.zeros(len(owners), dtype=bool)
            for owner in np.unique(owners):
                rows = np.flatnonzero(owners == owner)
                result[rows] = test(state.take(rows), self.targets[owner])
            return result

        return accessible

    def diagnose(self, owner: int) -> dict[str, Any]:
        """Passes over the target's centre, and what kept them from being windows.

        A pass is a pitch zero crossing of the centre, read at the grid sample nearest to
        it. The roll and the Sun barely change within one 15 s step, so this agrees with
        the search except for a pass right at the roll limit. A box is judged by its centre.
        """
        target = self.targets[owner]
        geo = geometry(self.coarse, np.repeat(target.center, len(self.coarse), 0))
        ok = self.coarse.valid & geo.front
        pitch = geo.pitch_deg
        before = np.flatnonzero(ok[:-1] & ok[1:] & (pitch[:-1] > 0) & (pitch[1:] <= 0))
        rows = np.where(np.abs(pitch[before]) < np.abs(pitch[before + 1]), before, before + 1)
        in_view = geo.sin_elev[rows] > 0
        roll = np.abs(geo.roll_deg[rows])
        reachable = in_view & (roll <= self.pointing.roll_reach_deg)
        dark = reachable & ~self.pointing.lit(geo.sin_sun[rows])
        sun = np.degrees(np.arcsin(np.clip(geo.sin_sun[rows], -1, 1)))
        return {
            "passes": int(reachable.sum()),
            "dark": int(dark.sum()),
            "best_sun_elev_deg": float(sun[dark].max()) if dark.any() else None,
            "nearest_roll_deg": float(roll[in_view].min()) if in_view.any() else None,
        }

    # Roll and pitch -----------------------------------------------------------------

    def _aimable(self, state: State, target: Target) -> np.ndarray:
        aim = target.aim_deg(state.lat_deg, state.lon_deg)
        return self.pointing.aimable(state.valid, geometry(state, aim))

    def _grid_cover(self, state: State, target: Target) -> np.ndarray:
        """Share of the box grid aimable at each row of ``state``."""
        grid = target.grid_deg()
        rows = np.repeat(np.arange(len(state)), len(grid))
        ok = self.pointing.aimable(
            state.valid[rows], geometry(state.take(rows), np.tile(grid, (len(state), 1)))
        )
        return ok.reshape(-1, len(grid)).mean(axis=1)

    def roll_pitch(self, owners: Sequence[int]) -> list[_Window]:
        runs: list[tuple[int, int, int]] = []
        for owner in owners:
            mask = self._aimable(self.coarse, self.targets[owner])
            runs.extend((owner, a, b) for a, b in _true_runs(mask))
        windows = []
        for owner, a, b, begin, finish in self._spans(runs, self._per_owner(self._aimable)):
            target = self.targets[owner]
            rows = np.arange(a, b + 1)
            state = self.coarse.take(rows)
            centred = np.abs(geometry(state, np.repeat(target.center, len(rows), 0)).pitch_deg)
            if target.box_deg is not None:
                covered = self._grid_cover(state, target)
                centred = np.where(covered == covered.max(), centred, np.inf)
            best = float(self.offsets[a + int(np.argmin(centred))])
            if target.box_deg is None:
                best = self._least_pitch(target, best, begin, finish)
            record = self._describe(target, best)
            windows.append(_Window(owner, begin, finish, best, a == 0, b == self.last, record))
        return windows

    def _least_pitch(self, target: Target, guess: float, begin: float, finish: float) -> float:
        lo, hi = max(begin, guess - ACCESS_STEP_S), min(finish, guess + ACCESS_STEP_S)
        for _ in range(BEST_STEPS):
            left, right = lo + (hi - lo) / 3, hi - (hi - lo) / 3
            both = self.at(np.array([left, right]))
            pitch = np.abs(geometry(both, np.repeat(target.center, 2, 0)).pitch_deg)
            if pitch[0] < pitch[1]:
                hi = right
            else:
                lo = left
        return (lo + hi) / 2

    def _describe(self, target: Target, best_s: float) -> dict[str, Any]:
        """Pointing at the best moment; a box is aimed at the middle of its covered part."""
        state = self.at(np.array([best_s]))
        grid = target.grid_deg()
        repeated = state.take(np.zeros(len(grid), dtype=int))
        covered = self.pointing.aimable(repeated.valid, geometry(repeated, grid))
        if target.box_deg is None:
            aim = target.center
        elif covered.any():
            aim = _middle(grid[covered])
        else:
            aim = target.aim_deg(state.lat_deg, state.lon_deg)
        geo = geometry(state, aim)
        return _record(state, aim, geo, float(covered.mean()))

    # Roll only ----------------------------------------------------------------------

    def roll_points(self, owners: Sequence[int]) -> list[_Window]:
        """Pitch zero crossings of each point, kept where roll, view and light allow."""
        events: list[tuple[int, int]] = []
        for owner in owners:
            target = self.targets[owner]
            geo = geometry(self.coarse, np.repeat(target.center, len(self.coarse), 0))
            ok = self.coarse.valid & geo.front
            pitch = geo.pitch_deg
            hits = np.flatnonzero(ok[:-1] & ok[1:] & (pitch[:-1] > 0) & (pitch[1:] <= 0))
            events.extend((owner, int(i)) for i in hits)
        if not events:
            return []
        centers = np.concatenate([self.targets[o].center for o, _ in events])
        index = np.array([i for _, i in events])
        lo, hi = self.offsets[index].copy(), self.offsets[index + 1].copy()
        for _ in range(CROSSING_STEPS):
            mid = (lo + hi) / 2
            ahead = geometry(self.at(mid), centers).pitch_deg > 0
            lo = np.where(ahead, mid, lo)
            hi = np.where(ahead, hi, mid)
        times = (lo + hi) / 2
        state = self.at(times)
        geo = geometry(state, centers)
        keep = self.pointing.on_plane(state.valid, geo)
        windows = []
        for row in np.flatnonzero(keep):
            owner = events[row][0]
            one, aim = state.take(np.array([row])), centers[row : row + 1]
            record = _record(one, aim, geometry(one, aim), 1.0)
            t = float(times[row])
            windows.append(_Window(owner, t, t, t, False, False, record))
        return windows

    def _arc_hits(self, state: State, target: Target) -> np.ndarray:
        """Rows whose lit cross-track arc within roll reach crosses the box."""
        assert target.box_deg is not None
        hits = np.zeros(len(state), dtype=bool)
        near = self._near_box(state, target)
        if not near.any():
            return hits
        sub = state.take(np.flatnonzero(near))
        arc = cross_track_arc(sub, self.pointing.roll_reach_deg, ARC_POINTS)
        inside = in_box(arc, target.box_deg)
        flat = arc.reshape(-1, 2)
        sun = np.repeat(sub.sun, ARC_POINTS, axis=0)
        sin_sun = (geodetic_normals(flat[:, 0], flat[:, 1]) * sun).sum(axis=1)
        lit = self.pointing.lit(sin_sun).reshape(len(sub), ARC_POINTS)
        hits[near] = sub.valid & (inside & lit).any(axis=1)
        return hits

    def _near_box(self, state: State, target: Target) -> np.ndarray:
        """Cheap prefilter: subpoints close enough for the arc to reach the box at all."""
        grid = target.grid_deg()
        radius = central_angle_deg(grid[:, 0], grid[:, 1], target.lat_deg, target.lon_deg).max()
        reach = self.pointing.roll_reach_deg
        return within_reach(state, target.lat_deg, target.lon_deg, float(radius), reach)

    def roll_boxes(self, owners: Sequence[int]) -> list[_Window]:
        runs: list[tuple[int, int, int]] = []
        for owner in owners:
            mask = self._arc_hits(self.coarse, self.targets[owner])
            runs.extend((owner, a, b) for a, b in _true_runs(mask))
        windows = []
        for owner, a, b, begin, finish in self._spans(runs, self._per_owner(self._arc_hits)):
            best, record = self._sweep(self.targets[owner], begin, finish)
            windows.append(_Window(owner, begin, finish, best, a == 0, b == self.last, record))
        return windows

    def _sweep(self, target: Target, begin: float, finish: float) -> tuple[float, dict[str, Any]]:
        """Crossing time and roll of each grid point while the strip sweeps the box."""
        pad = ACCESS_STEP_S
        samples = np.ceil((finish - begin + 2 * pad) / SWEEP_STEP_S)
        count = int(np.clip(samples, 3, MAX_SWEEP_SAMPLES))
        times = np.linspace(begin - pad, finish + pad, count)
        state = self.at(times)
        grid = target.grid_deg()
        rows = np.repeat(np.arange(count), len(grid))
        geo = geometry(state.take(rows), np.tile(grid, (count, 1)))
        pitch = geo.pitch_deg.reshape(count, -1)
        crossing = (pitch[:-1] > 0) & (pitch[1:] <= 0)
        ok = self.pointing.on_plane(state.valid[rows], geo).reshape(count, -1)
        roll = geo.roll_deg.reshape(count, -1)
        covered = np.zeros(len(grid), dtype=bool)
        cross_s = np.full(len(grid), np.nan)
        cross_roll = np.full(len(grid), np.nan)
        for point in range(len(grid)):
            hits = np.flatnonzero(crossing[:, point] & ok[:-1, point])
            if hits.size:
                j = int(hits[0])
                covered[point] = True
                cross_s[point] = times[j]
                cross_roll[point] = roll[j, point]
        middle = len(grid) // 2
        if covered[middle] and begin <= cross_s[middle] <= finish:
            best = float(cross_s[middle])
        elif covered.any():
            best = float(np.clip(np.nanmean(cross_s[covered]), begin, finish))
        else:
            best = (begin + finish) / 2
        one = self.at(np.array([best]))
        if covered.any():
            median = float(np.median(cross_roll[covered]))
            pick = int(np.nanargmin(np.where(covered, np.abs(cross_roll - median), np.nan)))
            aim = grid[pick : pick + 1]
            roll_deg = float(cross_roll[pick])
        else:
            aim = target.center
            roll_deg = float(geometry(one, aim).roll_deg[0])
        record = _record(one, aim, geometry(one, aim), float(covered.mean()))
        record.update(roll_deg=roll_deg, pitch_deg=0.0, min_off_nadir_deg=abs(roll_deg))
        return best, record


def _middle(points_deg: np.ndarray) -> np.ndarray:
    """The point of a set nearest the middle of it."""
    points_m = surface_ecef(points_deg)
    middle = points_m.mean(axis=0)
    return points_deg[[int(np.argmin(np.linalg.norm(points_m - middle, axis=1)))]]


def _record(state: State, aim: np.ndarray, geo: Any, coverage: float) -> dict[str, Any]:
    return {
        "min_off_nadir_deg": float(geo.off_nadir_deg[0]),
        "roll_deg": float(geo.roll_deg[0]),
        "pitch_deg": float(geo.pitch_deg[0]),
        "aim_lat_deg": float(aim[0, 0]),
        "aim_lon_deg": float(aim[0, 1]),
        "target_sun_elev_deg": _sun_elev_deg(geo.sin_sun),
        "coverage": coverage,
        "ascending": _ascending(state),
    }
