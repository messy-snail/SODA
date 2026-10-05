"""Eclipse intervals of a satellite: when the Earth blocks the line to the Sun.

The model is the one Skyfield's ``is_sunlit`` uses: a spherical Earth, a point Sun, and so a
cylindrical shadow with no penumbra. Entry and exit are interpolated between samples, which
keeps them within about a second for a LEO sampled every 30 to 60 s. An eclipse shorter than
one step can fall between two sunlit samples and be missed.
"""

import numpy as np

#: Radius of the shadowing sphere, the value Skyfield uses for the Earth (IERS 2010).
SHADOW_RADIUS_M = 6_378_136.6


def shadow_clearance_m(position_m: np.ndarray, sun_unit: np.ndarray) -> np.ndarray:
    """Signed distance from the shadow cylinder's surface, negative inside the shadow.

    Args:
        position_m: Satellite positions from the geocenter, shape ``(N, 3)``.
        sun_unit: Unit vectors toward the Sun in the same frame, shape ``(N, 3)``.

    Returns:
        Distance from the Earth-Sun axis minus the shadow radius on the night side, and the
        geocentric distance minus the radius on the day side. The two agree where they meet,
        so the result is continuous along an orbit.
    """
    along = np.einsum("ij,ij->i", position_m, sun_unit)
    radius = np.linalg.norm(position_m, axis=1)
    off_axis = np.sqrt(np.maximum(radius**2 - along**2, 0.0))
    return np.where(along < 0, off_axis, radius) - SHADOW_RADIUS_M


def eclipse_intervals_s(
    position_m: np.ndarray, sun_unit: np.ndarray, valid: np.ndarray, step_s: float
) -> list[float]:
    """Eclipse intervals as seconds from the first sample.

    Args:
        position_m: Satellite positions from the geocenter, shape ``(N, 3)``.
        sun_unit: Unit vectors toward the Sun in the same frame, shape ``(N, 3)``.
        valid: Samples that propagated, shape ``(N,)``. An interval never spans an invalid one.
        step_s: Sample spacing in seconds.

    Returns:
        Flat ``[enter0, exit0, enter1, exit1, ...]`` in ascending order. An eclipse already
        under way at the first sample of a valid run starts at that sample, and one still
        under way at the last sample ends there.
    """
    usable = np.where(valid)[0]
    if usable.size == 0:
        return []
    clearance = np.full(len(valid), np.nan)
    clearance[usable] = shadow_clearance_m(position_m[usable], sun_unit[usable])
    dark = clearance < 0

    intervals: list[float] = []
    breaks = np.where(np.diff(usable) > 1)[0] + 1
    for run in np.split(usable, breaks):
        first, last = int(run[0]), int(run[-1])
        edges: list[float] = [float(first)] if dark[first] else []
        changes = first + np.where(dark[first:last] != dark[first + 1 : last + 1])[0]
        before, after = clearance[changes], clearance[changes + 1]
        edges.extend((changes + before / (before - after)).tolist())
        if dark[last]:
            edges.append(float(last))
        for enter, leave in zip(edges[0::2], edges[1::2], strict=True):
            if leave > enter:
                intervals += [enter * step_s, leave * step_s]
    return intervals
