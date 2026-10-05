"""Coverage of an area: when each cell of a grid over a box can be imaged.

The box is cut into ``nx`` by ``ny`` cells and each cell is judged by its centre, with the
pointing models of ``access``:

- ``roll``: one event each time the cross-track plane passes over the centre (pitch 0)
  with the centre within roll reach, in view and lit.
- ``roll_pitch``: one event per stretch in which the centre is aimable, at its moment
  closest to pitch 0.

Events are read off the same 15 s grid ``access`` searches on, with the pitch zero crossing
interpolated between two samples instead of bisected, so an event is good to a second or
two. That is what makes thousands of cells affordable: ``access_report`` loops over its
targets, this works on every cell of a pass at once.

Only the event times are returned. Counts and revisit gaps depend on which satellites are
looked at together, so the caller derives them.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
from skyfield.jpllib import SpiceKernel

from ..errors import CodedError
from .access import ACCESS_STEP_S, MAX_ACCESS_WINDOW, _true_runs
from .access_geometry import (
    Pointing,
    State,
    central_angle_deg,
    geometry,
    state_at,
    within_reach,
    wrap_lon,
)
from .propagator import as_utc, satellite_from_omm

#: Cells of one grid. Keep in step with ``MAX_COVERAGE_CELLS`` in the frontend.
MAX_COVERAGE_CELLS = 2500
#: Sample-cell pairs one request may evaluate, about five seconds of work. It depends on
#: how much of the orbit passes near the box, so only the server can count it.
MAX_COVERAGE_PAIRS = 30_000_000
#: Events one response may carry, about 2 MB of JSON.
MAX_COVERAGE_EVENTS = 300_000
#: Pairs evaluated at once; bounds the working memory to some tens of megabytes.
COVERAGE_CHUNK_PAIRS = 200_000

Box = tuple[float, float, float, float]


class CoverageRequestError(CodedError, ValueError):
    """The requested window or grid is outside the supported limits."""


@dataclass(frozen=True)
class CoverageEvents:
    """Imaging events of every cell.

    Attributes:
        counts: Events per cell; cell ``j * nx + i`` is column ``i`` from the west and row
            ``j`` from the south.
        offset_s: Event times in seconds from the start, cell after cell, ascending
            within a cell.
    """

    counts: np.ndarray
    offset_s: np.ndarray


def cell_centres(box_deg: Box, nx: int, ny: int) -> np.ndarray:
    """``(nx * ny, 2)`` ``(lat, lon)`` centres of the cells, rows from the south.

    Args:
        box_deg: ``(west, south, east, north)``; ``east < west`` crosses the date line.
        nx: Cells across.
        ny: Cells up.
    """
    west, south, east, north = box_deg
    width = (east - west) % 360.0
    lats = south + (np.arange(ny) + 0.5) * (north - south) / ny
    lons = wrap_lon(west + (np.arange(nx) + 0.5) * width / nx)
    lat, lon = np.meshgrid(lats, lons, indexing="ij")
    return np.column_stack((lat.ravel(), lon.ravel()))


def _reach_deg(pointing: Pointing) -> float:
    """Largest angle off nadir the pointing model can look."""
    if pointing.mode == "roll":
        return pointing.roll_reach_deg
    roll = np.tan(np.radians(min(pointing.roll_reach_deg, 89.0)))
    pitch = np.tan(np.radians(pointing.max_pitch_deg))
    return float(np.degrees(np.arctan(np.hypot(roll, pitch))))


def _near(state: State, box_deg: Box, cells: np.ndarray, pointing: Pointing) -> np.ndarray:
    """Samples that can reach the box at all, widened by one sample on both sides."""
    west, south, east, north = box_deg
    lat0 = (south + north) / 2
    lon0 = float(wrap_lon(west + ((east - west) % 360.0) / 2))
    corners = np.array([[south, west], [south, east], [north, west], [north, east]])
    rim = np.vstack((cells, corners))
    radius = float(central_angle_deg(rim[:, 0], rim[:, 1], lat0, lon0).max())
    near = within_reach(state, lat0, lon0, radius, _reach_deg(pointing))
    widened = near.copy()
    widened[:-1] |= near[1:]
    widened[1:] |= near[:-1]
    return widened


def _crossing(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    """Fraction of the way from ``first`` to ``second`` at which the value passes zero."""
    span = first - second
    return np.where(span != 0, first / np.where(span != 0, span, 1.0), 0.0)


def _roll_events(
    pointing: Pointing, valid: np.ndarray, geo: Any, shape: tuple[int, int]
) -> tuple[np.ndarray, np.ndarray]:
    """Pitch zero crossings within roll reach: ``(cell columns, sample offsets)``."""
    ok = (valid & geo.front).reshape(shape)
    pitch = geo.pitch_deg.reshape(shape)
    crossed = ok[:-1] & ok[1:] & (pitch[:-1] > 0) & (pitch[1:] <= 0)
    row, column = np.nonzero(crossed)
    if not row.size:
        return column, row.astype(float)
    fraction = _crossing(pitch[row, column], pitch[row + 1, column])

    def at(values: np.ndarray) -> np.ndarray:
        grid = values.reshape(shape)
        return grid[row, column] + (grid[row + 1, column] - grid[row, column]) * fraction

    keep = (
        (np.abs(at(geo.roll_deg)) <= pointing.roll_reach_deg)
        & (at(geo.sin_elev) > 0)
        & pointing.lit(at(geo.sin_sun))
    )
    return column[keep], (row + fraction)[keep]


def _aimable_events(
    pointing: Pointing, valid: np.ndarray, geo: Any, shape: tuple[int, int]
) -> tuple[np.ndarray, np.ndarray]:
    """One event per aimable stretch of each cell, at its moment closest to pitch 0."""
    count = shape[0]
    aimable = pointing.aimable(valid, geo).reshape(shape)
    # Cell after cell, so a stretch is a run of consecutive samples of one cell.
    flat = np.flatnonzero(aimable.T.ravel())
    if not flat.size:
        return flat, flat.astype(float)
    column, row = flat // count, flat % count
    pitch = geo.pitch_deg.reshape(shape)
    lean = np.abs(pitch[row, column])
    fresh = np.ones(flat.size, dtype=bool)
    fresh[1:] = (column[1:] != column[:-1]) | (row[1:] != row[:-1] + 1)
    stretch = np.cumsum(fresh) - 1
    least = np.minimum.reduceat(lean, np.flatnonzero(fresh))
    _, pick = np.unique(stretch[lean == least[stretch]], return_index=True)
    best = np.flatnonzero(lean == least[stretch])[pick]
    row, column = row[best], column[best]

    # The sample nearest pitch 0 is up to half a step off; its neighbour on the other side
    # of zero, when there is one, places the crossing itself.
    here = pitch[row, column]
    other = np.clip(np.where(here > 0, row + 1, row - 1), 0, count - 1)
    there = pitch[other, column]
    straddles = (other != row) & (np.sign(there) != np.sign(here)) & (here != 0)
    step = np.where(straddles, _crossing(here, there) * (other - row), 0.0)
    return column, row + step


def coverage_events(
    omm: dict[str, Any],
    box_deg: Box,
    nx: int,
    ny: int,
    start: datetime,
    end: datetime,
    pointing: Pointing,
    kernel: SpiceKernel,
    chunk_pairs: int = COVERAGE_CHUNK_PAIRS,
) -> CoverageEvents:
    """When each cell of a grid over a box can be imaged.

    Args:
        omm: Normalized OMM fields.
        box_deg: ``(west, south, east, north)``; ``east < west`` crosses the date line.
        nx: Cells across.
        ny: Cells up.
        start: Window start (naive values are UTC).
        end: Window end.
        pointing: Pointing model, limits and lighting.
        kernel: DE421 for the Sun direction.
        chunk_pairs: Sample-cell pairs evaluated at once.

    Raises:
        CoverageRequestError: The window, the grid, or the work it takes is outside the
            supported limits.
    """
    start, end = as_utc(start), as_utc(end)
    if end <= start:
        raise CoverageRequestError("endBeforeStart", "종료 시각은 시작 시각보다 늦어야 함")
    if end - start > MAX_ACCESS_WINDOW:
        raise CoverageRequestError(
            "accessWindowTooLong",
            f"촬영 기회 계산 기간은 최대 {MAX_ACCESS_WINDOW.days}일",
            days=MAX_ACCESS_WINDOW.days,
        )
    total = nx * ny
    if total > MAX_COVERAGE_CELLS:
        raise CoverageRequestError(
            "coverageGridTooLarge",
            f"커버리지 격자는 최대 {MAX_COVERAGE_CELLS}칸",
            max=MAX_COVERAGE_CELLS,
        )

    span_s = (end - start).total_seconds()
    offsets = np.linspace(0.0, span_s, int(np.ceil(span_s / ACCESS_STEP_S)) + 1)
    step_s = float(offsets[1] - offsets[0])
    coarse = state_at(satellite_from_omm(omm), kernel, start, offsets)
    cells = cell_centres(box_deg, nx, ny)
    near = _near(coarse, box_deg, cells, pointing)
    pairs = int(near.sum()) * total
    if pairs > MAX_COVERAGE_PAIRS:
        raise _too_heavy(total * MAX_COVERAGE_PAIRS / pairs)

    find = _roll_events if pointing.mode == "roll" else _aimable_events
    found_cells: list[np.ndarray] = []
    found_times: list[np.ndarray] = []
    events = 0
    for first, last in _true_runs(near):
        rows = np.arange(first, last + 1)
        if len(rows) < 2:
            continue
        state = coarse.take(rows)
        width = max(1, chunk_pairs // len(rows))
        for begin in range(0, total, width):
            group = cells[begin : begin + width]
            shape = (len(rows), len(group))
            paired = np.repeat(np.arange(len(rows)), len(group))
            geo = geometry(state.take(paired), np.tile(group, (len(rows), 1)))
            column, sample = find(pointing, state.valid[paired], geo, shape)
            found_cells.append(begin + column)
            found_times.append((first + sample) * step_s)
            events += len(column)
        if events > MAX_COVERAGE_EVENTS:
            raise _too_heavy(total * MAX_COVERAGE_EVENTS / events * (last + 1) / len(offsets))

    cell = np.concatenate(found_cells) if found_cells else np.empty(0, dtype=int)
    time = np.concatenate(found_times) if found_times else np.empty(0)
    order = np.lexsort((time, cell))
    return CoverageEvents(
        counts=np.bincount(cell, minlength=total),
        offset_s=np.clip(np.rint(time[order]), 0, span_s).astype(int),
    )


def _too_heavy(cells: float) -> CoverageRequestError:
    """The refusal, with a cell count that would fit, rounded down to a hundred."""
    fits = max(100, int(cells // 100) * 100)
    return CoverageRequestError(
        "coverageTooHeavy",
        f"커버리지 계산량 초과 · 영역이나 기간을 줄이거나 격자를 {fits}칸 이하로 낮춰야 함",
        max_cells=fits,
    )
