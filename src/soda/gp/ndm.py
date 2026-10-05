"""Readers shared by the CCSDS Navigation Data Messages SODA accepts.

OMM, OPM and OEM all come in two encodings: KVN (``KEY = VALUE`` lines) and XML. This module
only turns either encoding into plain keys and strings; what the keys mean is up to the
caller.
"""

import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta

#: ``YYYY-DDDThh:mm:ss[.f]``, the day-of-year form CCSDS allows next to the calendar form.
_DAY_OF_YEAR = re.compile(r"^(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$")
_UNIT = re.compile(r"\s*\[[^\]]*\]\s*$")
_FORBIDDEN_XML = re.compile(r"<!(DOCTYPE|ENTITY)", re.IGNORECASE)


def parse_epoch(value: str) -> datetime:
    """Parse a CCSDS epoch, calendar or day-of-year, as UTC.

    Raises:
        ValueError: The text is in neither form.
    """
    text = value.strip().removesuffix("Z")
    match = _DAY_OF_YEAR.match(text)
    if match:
        year, day, hour, minute = (int(match.group(i)) for i in range(1, 5))
        if not 1 <= day <= 366:
            raise ValueError(f"invalid day of year in {value!r}")
        return datetime(year, 1, 1, tzinfo=UTC) + timedelta(
            days=day - 1, hours=hour, minutes=minute, seconds=float(match.group(5))
        )
    parsed = datetime.fromisoformat(text)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def kvn_pairs(text: str) -> list[tuple[str, str]]:
    """``KEY = VALUE`` lines in order, without comments, blank lines, or ``[unit]`` suffixes.

    Lines that are not key-value pairs (OEM ephemeris rows, ``META_START``) come back with
    an empty key and the whole line as the value.
    """
    pairs: list[tuple[str, str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("COMMENT"):
            continue
        key, separator, value = line.partition("=")
        if separator and re.fullmatch(r"[A-Z0-9_]+", key.strip()):
            pairs.append((key.strip(), _UNIT.sub("", value).strip()))
        else:
            pairs.append(("", line))
    return pairs


def split_kvn_messages(pairs: list[tuple[str, str]], version_key: str) -> list[dict[str, str]]:
    """Group KVN pairs into messages, each starting at ``version_key``.

    Concatenated messages are common (CelesTrak's ``FORMAT=KVN`` answers that way), so one
    file may hold several.
    """
    messages: list[dict[str, str]] = []
    for key, value in pairs:
        if key == version_key:
            messages.append({})
        if key and messages:
            messages[-1][key] = value
    return messages


def parse_xml(text: str) -> ET.Element:
    """Parse an NDM XML document with namespaces removed from the tag names.

    A document type declaration is refused before parsing: that is where entity expansion
    and external entities come from, and no NDM needs one.

    Raises:
        ValueError: The text has a DOCTYPE or ENTITY declaration, or is not well-formed.
    """
    if _FORBIDDEN_XML.search(text):
        raise ValueError("XML document type declarations are not accepted")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise ValueError(f"invalid XML: {error}") from error
    for element in root.iter():
        element.tag = element.tag.rpartition("}")[2]
    return root


def leaf_values(element: ET.Element) -> dict[str, str]:
    """Text of every childless descendant, keyed by tag name."""
    return {
        leaf.tag: (leaf.text or "").strip()
        for leaf in element.iter()
        if len(leaf) == 0 and leaf is not element
    }
