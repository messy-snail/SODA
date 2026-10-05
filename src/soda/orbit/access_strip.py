"""What an imaging opportunity puts on the ground: the shot's span, strip, and track.

The shot is ``shot_s`` seconds centred on the best moment and kept inside the window; a
window shorter than that (the single instant of a roll-only point) does not bound it. A
roll-only box is imaged for its whole sweep. Over the shot the sensor holds the window's
roll, so the strip is the ground between ``roll - fov/2`` and ``roll + fov/2`` (a sliver
when the FOV is zero, so it still shows), sampled every ``STRIP_STEP_S``.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from .access_geometry import Pointing, State
from .swath import HORIZON_MARGIN_RAD, WGS84_A, WGS84_E2, intersect_ellipsoid, surface_lonlat

STRIP_STEP_S = 1.0
MAX_STRIP_POINTS = 600
#: Half-width drawn for a sensor with no field of view, in degrees.
SLIVER_HALF_DEG = 0.25


@dataclass(frozen=True)
class Shot:
    begin_s: float
    finish_s: float


def shot_span(begin_s: float, finish_s: float, best_s: float, shot_s: float, sweep: bool) -> Shot:
    """The imaged span of a window (seconds from the search start)."""
    if sweep:
        return Shot(begin_s, finish_s)
    half = shot_s / 2
    if finish_s - begin_s >= shot_s:
        return Shot(max(begin_s, best_s - half), min(finish_s, best_s + half))
    return Shot(best_s - half, best_s + half)


def ground_at_roll(state: State, roll_deg: float) -> np.ndarray:
    """``(N, 2)`` ``(lon, lat)`` where a look rolled by ``roll_deg`` meets the ground."""
    radius = np.linalg.norm(state.position_m, axis=1)
    horizon = np.arcsin(np.clip(WGS84_A * (1 - WGS84_E2 / 2) / radius, 0, 1))
    angle = np.clip(
        np.radians(roll_deg), -(horizon - HORIZON_MARGIN_RAD), horizon - HORIZON_MARGIN_RAD
    )
    look = np.cos(angle)[:, None] * -state.up + np.sin(angle)[:, None] * state.right
    return surface_lonlat(intersect_ellipsoid(state.position_m, look))


def attach_strips(
    shots: list[tuple[Shot, float, dict]],
    pointing: Pointing,
    at: Callable[[np.ndarray], State],
) -> None:
    """Add ``shot`` span, ``strip`` edges and ``track_fixed_m`` to each record in place.

    Args:
        shots: ``(shot, roll_deg, record)`` per window; all are sampled in one call.
        pointing: For the field of view.
        at: Satellite state at offsets in seconds from the search start.
    """
    if not shots:
        return
    counts = [
        int(np.clip(np.ceil((s.finish_s - s.begin_s) / STRIP_STEP_S) + 1, 2, MAX_STRIP_POINTS))
        for s, _, _ in shots
    ]
    times = np.concatenate(
        [np.linspace(s.begin_s, s.finish_s, n) for (s, _, _), n in zip(shots, counts, strict=True)]
    )
    state = at(times)
    half = max(pointing.fov_deg / 2, SLIVER_HALF_DEG)
    first = 0
    for (shot, roll, record), count in zip(shots, counts, strict=True):
        rows = state.take(np.arange(first, first + count))
        first += count
        record["shot_start_s"] = shot.begin_s
        record["shot_end_s"] = shot.finish_s
        record["strip_left"] = ground_at_roll(rows, roll - half)
        record["strip_right"] = ground_at_roll(rows, roll + half)
        record["track_fixed_m"] = rows.position_m


def strips_for(
    windows: Sequence[Any],
    targets: Sequence[Any],
    pointing: Pointing,
    shot_s: float,
    at: Callable[[np.ndarray], State],
) -> None:
    """Shot span and strip for each search window (``access._Window``), in place."""
    sweep = pointing.mode == "roll"
    attach_strips(
        [
            (
                shot_span(
                    w.begin_s,
                    w.finish_s,
                    w.best_s,
                    shot_s,
                    sweep and targets[w.owner].box_deg is not None,
                ),
                w.record["roll_deg"],
                w.record,
            )
            for w in windows
        ],
        pointing,
        at,
    )
