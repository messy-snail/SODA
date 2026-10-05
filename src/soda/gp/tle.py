"""User-supplied orbital elements: the one place a TLE is turned into OMM.

Everything SODA propagates is an OMM record that went through ``normalize_omm``. A TLE the
user pastes is converted here with the unit conversions ``sgp4.exporter.export_omm`` uses,
and the result goes straight through ``normalize_omm`` like any downloaded record.
"""

import json
from datetime import UTC, datetime, timedelta
from math import degrees, pi
from typing import Any, Literal

from sgp4 import omm as sgp4_omm
from sgp4.api import Satrec
from sgp4.io import verify_checksum

from ..errors import CodedError
from .models import InvalidOmm, normalize_omm

#: Revolutions per day for one radian per minute (``sgp4.io``'s ``xpdotp``).
XPDOTP = 1440.0 / (2.0 * pi)
#: Julian date of 1970-01-01T00:00:00 UTC.
JD_UNIX_EPOCH = 2440587.5
INVALID_TEXT = "궤도요소 형식 오류 · TLE 2~3줄 또는 OMM JSON 필요"

InputFormat = Literal["tle", "omm"]


def _invalid() -> CodedError:
    return CodedError("customElementsInvalid", INVALID_TEXT)


def _object_id(intldesg: str) -> str:
    """CelesTrak-style international designator (``98067A`` -> ``1998-067A``), or ``""``."""
    text = intldesg.strip()
    if len(text) < 5 or not text[:5].isdigit():
        return ""
    year = int(text[:2])
    year += 1900 if year >= 57 else 2000
    return f"{year}-{text[2:]}"


def tle_to_omm(line1: str, line2: str, name: str | None = None) -> dict[str, Any]:
    """Convert one TLE into a CelesTrak-style OMM record.

    Both lines must carry a valid checksum in column 69; ``Satrec.twoline2rv`` does not check
    it, so a typo would otherwise propagate silently. Alpha-5 catalog numbers (``A0123``)
    are accepted and come out as integers (100123).

    Args:
        line1: TLE line 1.
        line2: TLE line 2.
        name: Object name; defaults to ``NORAD <number>``.

    Returns:
        Raw OMM fields, still to be passed through ``normalize_omm``.

    Raises:
        ValueError: The lines are not a well-formed TLE.
    """
    line1, line2 = line1.rstrip(), line2.rstrip()
    if not (line1.startswith("1 ") and line2.startswith("2 ")):
        raise ValueError("TLE lines must start with '1 ' and '2 '")
    if len(line1) != 69 or len(line2) != 69:
        raise ValueError("TLE lines must be 69 characters long")
    if line1[2:7] != line2[2:7]:
        raise ValueError("catalog numbers in lines 1 and 2 differ")
    verify_checksum(line1, line2)
    satrec = Satrec.twoline2rv(line1, line2)
    if satrec.error:
        raise ValueError(f"SGP4 rejected the elements (error {satrec.error})")
    days = (satrec.jdsatepoch - JD_UNIX_EPOCH) + satrec.jdsatepochF
    epoch = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(days=days)
    return {
        "OBJECT_NAME": (name or "").strip() or f"NORAD {satrec.satnum}",
        "OBJECT_ID": _object_id(satrec.intldesg),
        "EPOCH": epoch.strftime("%Y-%m-%dT%H:%M:%S.%f"),
        "MEAN_MOTION": satrec.no_kozai * XPDOTP,
        "ECCENTRICITY": satrec.ecco,
        "INCLINATION": degrees(satrec.inclo),
        "RA_OF_ASC_NODE": degrees(satrec.nodeo),
        "ARG_OF_PERICENTER": degrees(satrec.argpo),
        "MEAN_ANOMALY": degrees(satrec.mo),
        "EPHEMERIS_TYPE": satrec.ephtype,
        "CLASSIFICATION_TYPE": satrec.classification or "U",
        "NORAD_CAT_ID": satrec.satnum,
        "ELEMENT_SET_NO": satrec.elnum,
        "REV_AT_EPOCH": satrec.revnum,
        "BSTAR": satrec.bstar,
        # sgp4 keeps ndot in rad/min^2 and nddot in rad/min^3; OMM uses rev/day^2 and ^3.
        "MEAN_MOTION_DOT": satrec.ndot * XPDOTP * 1440.0,
        "MEAN_MOTION_DDOT": satrec.nddot * XPDOTP * 1440.0**2,
    }


def _parse_json(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
    except ValueError as error:
        raise ValueError("invalid JSON") from error
    if isinstance(data, list):
        if len(data) != 1:
            raise ValueError("an OMM list must hold exactly one record")
        data = data[0]
    if not isinstance(data, dict):
        raise ValueError("OMM JSON must be an object")
    return data


def _parse_tle(lines: list[str]) -> dict[str, Any]:
    if len(lines) == 2:
        return tle_to_omm(lines[0], lines[1])
    if len(lines) == 3:
        name = lines[0].removeprefix("0 ") if lines[0].startswith("0 ") else lines[0]
        return tle_to_omm(lines[1], lines[2], name)
    raise ValueError("expected 2 or 3 TLE lines")


def split_tle_records(text: str) -> list[tuple[str | None, str, str]]:
    """Split a TLE file into ``(name, line1, line2)`` records, 2-line and 3-line mixed.

    A line that belongs to no record comes back as ``(None, line, "")`` so that the caller
    reports it as one bad record instead of dropping it silently.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    records: list[tuple[str | None, str, str]] = []
    index = 0
    while index < len(lines):
        rest = lines[index : index + 3]
        if len(rest) >= 2 and rest[0].startswith("1 ") and rest[1].startswith("2 "):
            records.append((None, rest[0], rest[1]))
            index += 2
        elif len(rest) == 3 and rest[1].startswith("1 ") and rest[2].startswith("2 "):
            records.append((rest[0].removeprefix("0 "), rest[1], rest[2]))
            index += 3
        else:
            records.append((None, rest[0], ""))
            index += 1
    return records


def check_sgp4(omm: dict[str, Any]) -> None:
    """Reject elements SGP4 cannot start from, such as an eccentricity outside [0, 1)."""
    satrec = Satrec()
    # The catalog number plays no part in the check and may exceed what SGP4 accepts.
    sgp4_omm.initialize(satrec, {**omm, "NORAD_CAT_ID": 0})
    error, _, _ = satrec.sgp4(satrec.jdsatepoch, satrec.jdsatepochF)
    if satrec.error or error:
        raise ValueError(f"SGP4 rejected the elements (error {satrec.error or error})")


def parse_custom_elements(text: str) -> tuple[dict[str, Any], InputFormat]:
    """Read elements pasted by the user: a TLE, a 3LE, or one OMM JSON record.

    Args:
        text: A JSON object or one-element list, or 2 TLE lines optionally preceded by a
            name line (a 3LE ``0 NAME`` line included).

    Returns:
        The normalized OMM fields and which format the text was in.

    Raises:
        CodedError: ``customElementsInvalid`` when the text is none of the above or the
            elements cannot be used for SGP4.
    """
    stripped = text.strip()
    input_format: InputFormat = "omm" if stripped[:1] in ("{", "[") else "tle"
    try:
        if input_format == "omm":
            record = _parse_json(stripped)
        else:
            lines = [line.strip() for line in stripped.splitlines() if line.strip()]
            record = _parse_tle(lines)
        elements = normalize_omm(record, "user")
        check_sgp4(elements.omm)
    except (ValueError, InvalidOmm) as error:
        raise _invalid() from error
    return elements.omm, input_format
