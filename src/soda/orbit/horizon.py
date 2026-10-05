"""Per-station horizon masks: the minimum elevation required at each azimuth.

A mask is a piecewise-linear curve through ``(azimuth, minimum elevation)`` vertices that
wraps around 360 deg. It models terrain or structures around a ground station, which no
network publishes per antenna, so the values come from the user.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .propagator import PropagationRequestError

MIN_MASK_POINTS = 2
MAX_MASK_POINTS = 72
MAX_MASK_ELEV_DEG = 89.0


# ``eq=False`` keeps the ndarray fields out of comparisons, which would return arrays.
@dataclass(frozen=True, eq=False)
class HorizonMask:
    """Minimum elevation as a function of azimuth, sampled at sorted vertices."""

    az_deg: np.ndarray
    elev_deg: np.ndarray

    @classmethod
    def from_points(cls, points: Sequence[Sequence[float]] | None) -> "HorizonMask | None":
        """Build a mask from ``(az_deg, min_elev_deg)`` pairs, or ``None`` when empty.

        Returning ``None`` for an empty mask keeps every caller to a single ``is None`` branch.

        Raises:
            PropagationRequestError: Vertex count, range, or ordering is not usable.
        """
        if not points:
            return None
        if len(points) < MIN_MASK_POINTS:
            raise PropagationRequestError(
                "maskTooFewPoints",
                f"방위각 마스크는 점이 {MIN_MASK_POINTS}개 이상 필요",
                min=MIN_MASK_POINTS,
            )
        if len(points) > MAX_MASK_POINTS:
            raise PropagationRequestError(
                "maskTooManyPoints",
                f"방위각 마스크 점은 최대 {MAX_MASK_POINTS}개",
                max=MAX_MASK_POINTS,
            )
        pairs = np.asarray(points, dtype=float)
        if pairs.ndim != 2 or pairs.shape[1] != 2 or not np.isfinite(pairs).all():
            raise PropagationRequestError(
                "maskBadPoint", "방위각 마스크 점은 (방위각, 최소 고도각) 쌍이어야 함"
            )
        az, elev = pairs[:, 0], pairs[:, 1]
        if np.any(az < 0.0) or np.any(az >= 360.0):
            raise PropagationRequestError(
                "maskAzimuthRange", "마스크 방위각은 0° 이상 360° 미만이어야 함"
            )
        if np.any(elev < 0.0) or np.any(elev > MAX_MASK_ELEV_DEG):
            raise PropagationRequestError(
                "maskElevationRange",
                f"마스크 최소 고도각은 0°에서 {MAX_MASK_ELEV_DEG:g}° 사이여야 함",
                max=MAX_MASK_ELEV_DEG,
            )
        order = np.argsort(az, kind="stable")
        az, elev = az[order], elev[order]
        if np.any(np.diff(az) == 0.0):
            raise PropagationRequestError("maskDuplicateAzimuth", "마스크 방위각 중복")
        return cls(az_deg=az, elev_deg=elev)

    @property
    def floor_deg(self) -> float:
        """Lowest elevation the mask ever requires.

        Linear interpolation never dips below its vertices, so this is an exact lower bound
        for an event search that must not miss any mask-passing interval.
        """
        return float(self.elev_deg.min())

    @property
    def ceiling_deg(self) -> float:
        """Highest elevation the mask requires."""
        return float(self.elev_deg.max())

    def elevation_at(self, az_deg: np.ndarray | float) -> np.ndarray:
        """Required elevation at each azimuth, interpolated across the 360 deg wrap."""
        return np.interp(
            np.asarray(az_deg, dtype=float) % 360.0, self.az_deg, self.elev_deg, period=360.0
        )

    def as_points(self) -> list[tuple[float, float]]:
        """Vertices as plain ``(az_deg, min_elev_deg)`` tuples."""
        return [(float(a), float(e)) for a, e in zip(self.az_deg, self.elev_deg, strict=True)]
