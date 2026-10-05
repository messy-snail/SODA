"""Lagrange interpolation of tabulated states, the way an OEM is meant to be read."""

import numpy as np

MIN_DEGREE = 1
MAX_DEGREE = 11
DEFAULT_DEGREE = 7


def clamp_degree(degree: int, node_count: int) -> int:
    """A usable polynomial degree for a table of ``node_count`` nodes."""
    return max(MIN_DEGREE, min(int(degree), MAX_DEGREE, node_count - 1))


def lagrange(nodes: np.ndarray, values: np.ndarray, query: np.ndarray, degree: int) -> np.ndarray:
    """Interpolate each column of ``values`` at ``query``.

    Every query uses the ``degree + 1`` nodes around it, shifted inwards near the ends of
    the table, so the polynomial is never extrapolated across more than half a window.

    Args:
        nodes: ``(M,)`` strictly increasing abscissae; they need not be evenly spaced.
        values: ``(M, K)`` ordinates.
        query: ``(N,)`` abscissae inside ``[nodes[0], nodes[-1]]``.
        degree: Polynomial degree; ``M`` must be at least ``degree + 1``.

    Returns:
        ``(N, K)`` interpolated values.
    """
    nodes = np.asarray(nodes, dtype=float)
    query = np.asarray(query, dtype=float)
    width = degree + 1
    if len(nodes) < width:
        raise ValueError(f"degree {degree} needs {width} nodes, got {len(nodes)}")
    first = np.searchsorted(nodes, query) - width // 2
    first = np.clip(first, 0, len(nodes) - width)
    window = first[:, np.newaxis] + np.arange(width)
    # Offsets from the query keep the products well scaled whatever the epoch.
    offsets = query[:, np.newaxis] - nodes[window]
    spacing = nodes[window][:, :, np.newaxis] - nodes[window][:, np.newaxis, :]
    result = np.zeros((len(query), values.shape[1]))
    for j in range(width):
        others = np.arange(width) != j
        weight = np.prod(offsets[:, others] / spacing[:, j, others], axis=1)
        result += weight[:, np.newaxis] * values[window[:, j]]
    return result
