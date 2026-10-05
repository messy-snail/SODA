"""Object category from name and mean elements.

Rules follow OrbitView ``src/lib/space-objects.ts`` (MIT, OrbitView Contributors).

The rule exists twice: ``classify`` for a single OMM in Python, and ``CATEGORY_SQL`` for
filtering ``gp_latest`` rows inside SQLite before ``LIMIT``. Both are built from the constants
below, and ``tests/test_classify_sql.py`` checks that they agree row by row. Change them together.
"""

from typing import Any, Literal

Category = Literal["DEBRIS", "LEO", "GEO", "HEO", "MEO"]
CATEGORIES: tuple[Category, ...] = ("LEO", "MEO", "GEO", "HEO", "DEBRIS")
DEBRIS_MARKERS = ("DEBRIS", "ROCKET BODY", " DEB", "R/B", "OBJECT ")

LEO_MIN_MEAN_MOTION = 11.25  # rev/day, exclusive
GEO_MEAN_MOTION_RANGE = (0.9, 1.1)  # rev/day, both ends exclusive
GEO_MAX_ECCENTRICITY = 0.1  # exclusive
HEO_MIN_ECCENTRICITY = 0.25  # exclusive


def classify(omm: dict[str, Any]) -> Category:
    """Classify by name markers, mean motion (rev/day), and eccentricity.

    Args:
        omm: OMM record with ``MEAN_MOTION``, ``ECCENTRICITY`` and optionally ``OBJECT_NAME``.

    Returns:
        The object category.
    """
    name = str(omm.get("OBJECT_NAME", "")).upper()
    mean_motion = float(omm["MEAN_MOTION"])
    eccentricity = float(omm["ECCENTRICITY"])
    if any(marker in name for marker in DEBRIS_MARKERS):
        return "DEBRIS"
    if mean_motion > LEO_MIN_MEAN_MOTION:
        return "LEO"
    geo_low, geo_high = GEO_MEAN_MOTION_RANGE
    if geo_low < mean_motion < geo_high and eccentricity < GEO_MAX_ECCENTRICITY:
        return "GEO"
    if eccentricity > HEO_MIN_ECCENTRICITY:
        return "HEO"
    return "MEO"


def _sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _category_sql(column: str) -> str:
    """SQLite expression mirroring ``classify`` over a JSON OMM text column.

    ``instr`` is a plain substring test like Python ``in``, so markers need no LIKE escaping.
    Numbers are cast to REAL so string-valued fields compare like ``float()`` would.
    """
    name = f"upper(coalesce(json_extract({column}, '$.OBJECT_NAME'), ''))"
    mean_motion = f"CAST(json_extract({column}, '$.MEAN_MOTION') AS REAL)"
    eccentricity = f"CAST(json_extract({column}, '$.ECCENTRICITY') AS REAL)"
    debris = " OR ".join(f"instr({name}, {_sql_text(m)}) > 0" for m in DEBRIS_MARKERS)
    geo_low, geo_high = GEO_MEAN_MOTION_RANGE
    return (
        "CASE"
        f" WHEN {debris} THEN 'DEBRIS'"
        f" WHEN {mean_motion} > {LEO_MIN_MEAN_MOTION!r} THEN 'LEO'"
        f" WHEN {mean_motion} > {geo_low!r} AND {mean_motion} < {geo_high!r}"
        f" AND {eccentricity} < {GEO_MAX_ECCENTRICITY!r} THEN 'GEO'"
        f" WHEN {eccentricity} > {HEO_MIN_ECCENTRICITY!r} THEN 'HEO'"
        " ELSE 'MEO' END"
    )


CATEGORY_SQL = _category_sql("omm")
"""``classify`` as a SQLite expression over ``gp_latest.omm`` (needs the JSON1 functions)."""
