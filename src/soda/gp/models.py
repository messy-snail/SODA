"""OMM (Orbit Mean-Elements Message) records shared by every GP data source."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

FLOAT_FIELDS = (
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
)
OPTIONAL_INT_FIELDS = ("EPHEMERIS_TYPE", "ELEMENT_SET_NO", "REV_AT_EPOCH")


class InvalidOmm(ValueError):
    """Raised when a record cannot be used for SGP4."""


@dataclass(frozen=True)
class ElementSet:
    """One normalized GP element set."""

    norad_id: int
    name: str
    object_id: str
    epoch: datetime
    source: str
    omm: dict[str, Any]


def parse_epoch(value: str) -> datetime:
    """Parse an OMM epoch such as ``2026-09-15T21:14:23.428032`` as UTC."""
    text = value.strip().removesuffix("Z")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise InvalidOmm(f"invalid EPOCH {value!r}") from error
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def format_epoch(value: datetime) -> str:
    """Format an epoch the way ``sgp4.omm.initialize`` expects."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")


def normalize_omm(record: dict[str, Any], source: str) -> ElementSet:
    """Coerce a CelesTrak or Space-Track OMM record into typed standard fields.

    Space-Track returns every value as a string and adds many extra fields;
    CelesTrak returns numbers. Both become the same numeric shape.

    Args:
        record: Raw OMM JSON object.
        source: Provider name stored with the element set.

    Returns:
        Normalized element set.

    Raises:
        InvalidOmm: A required field is missing or malformed.
    """
    omm: dict[str, Any] = {}
    try:
        for key in FLOAT_FIELDS:
            omm[key] = float(record[key])
        omm["NORAD_CAT_ID"] = int(record["NORAD_CAT_ID"])
        for key in OPTIONAL_INT_FIELDS:
            omm[key] = int(record.get(key) or 0)
        epoch = parse_epoch(str(record["EPOCH"]))
    except (KeyError, TypeError, ValueError) as error:
        raise InvalidOmm(f"invalid OMM record: {error}") from error
    omm["OBJECT_NAME"] = str(record.get("OBJECT_NAME") or f"NORAD {omm['NORAD_CAT_ID']}").strip()
    omm["OBJECT_ID"] = str(record.get("OBJECT_ID") or "").strip()
    omm["CLASSIFICATION_TYPE"] = str(record.get("CLASSIFICATION_TYPE") or "U")
    omm["EPOCH"] = format_epoch(epoch)
    if omm["MEAN_MOTION"] <= 0:
        raise InvalidOmm("MEAN_MOTION must be positive")
    return ElementSet(
        norad_id=omm["NORAD_CAT_ID"],
        name=omm["OBJECT_NAME"],
        object_id=omm["OBJECT_ID"],
        epoch=epoch,
        source=source,
        omm=omm,
    )
