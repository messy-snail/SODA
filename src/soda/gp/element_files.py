"""Orbital element files: several satellites at once, in any encoding of TLE or OMM.

A file is a TLE list (2-line and 3-line mixed), or OMM as JSON, XML, KVN or CelesTrak CSV.
Whatever the encoding, each record ends up as OMM fields that went through
``normalize_omm`` and the SGP4 check, exactly like elements pasted one at a time. TLE lines
still go through ``tle_to_omm`` only.
"""

import csv
import io
import json
from dataclasses import dataclass
from typing import Any, Literal

from ..errors import CodedError
from . import ndm
from .models import InvalidOmm, format_epoch, normalize_omm
from .tle import InputFormat, check_sgp4, split_tle_records, tle_to_omm

MAX_ELEMENT_FILE_BYTES = 2 * 1024 * 1024
MAX_ELEMENT_FILE_RECORDS = 500
MAX_NAME_LENGTH = 60

FileFormat = Literal["tle", "json", "xml", "kvn", "csv"]
SkipReason = Literal["invalid", "duplicate"]

#: ``MEAN_ELEMENT_THEORY`` values SGP4 can propagate; SGP4-XP needs a different propagator.
SGP4_THEORIES = frozenset({"SGP", "SGP4", "SGP/SGP4"})
#: Fields only an SGP4-XP element set carries.
XP_FIELDS = ("BTERM", "AGOM")


@dataclass(frozen=True)
class ParsedRecord:
    """One record of a file. ``omm`` is ``None`` when the record cannot be used."""

    index: int
    name: str
    omm: dict[str, Any] | None
    input_format: InputFormat


@dataclass(frozen=True)
class ImportPlan:
    """What an import will store, and which records it leaves out and why."""

    #: ``(name, omm, input_format)`` in file order, names already made unique.
    create: list[tuple[str, dict[str, Any], InputFormat]]
    #: ``(index, name, reason)`` in file order.
    skipped: list[tuple[int, str, SkipReason]]


def _unreadable(text: str) -> CodedError:
    return CodedError("elementFileUnreadable", text)


def detect_format(text: str) -> FileFormat:
    """Which encoding a file is in, from its first characters and first line.

    Raises:
        CodedError: ``elementFileWrongKind`` for an OPM or OEM, which hold a state vector
            or an ephemeris rather than mean elements.
    """
    head = text.lstrip()
    if head[:1] in ("{", "["):
        return "json"
    if head[:1] == "<":
        return "xml"
    for kind in ("OPM", "OEM"):
        if f"CCSDS_{kind}_VERS" in head[:2000]:
            raise CodedError(
                "elementFileWrongKind",
                f"{kind} 파일은 궤도요소가 아님 · TLE 또는 OMM 파일 필요",
                kind=kind,
            )
    if "CCSDS_OMM_VERS" in head[:2000]:
        return "kvn"
    first_line = head.partition("\n")[0]
    if "OBJECT_NAME" in first_line and "MEAN_MOTION" in first_line:
        return "csv"
    return "tle"


def _usable(fields: dict[str, Any]) -> dict[str, Any]:
    """Check what ``normalize_omm`` does not: theory, time system, and the epoch form."""
    theory = str(fields.get("MEAN_ELEMENT_THEORY") or "SGP4").strip().upper()
    if theory not in SGP4_THEORIES:
        raise ValueError(f"unsupported MEAN_ELEMENT_THEORY {theory!r}")
    if str(fields.get("TIME_SYSTEM") or "UTC").strip().upper() != "UTC":
        raise ValueError("TIME_SYSTEM must be UTC")
    if any(str(fields.get(key) or "").strip() for key in XP_FIELDS):
        raise ValueError("SGP4-XP elements are not supported")
    return {**fields, "EPOCH": format_epoch(ndm.parse_epoch(str(fields["EPOCH"])))}


def _json_records(text: str) -> list[Any]:
    try:
        data = json.loads(text)
    except ValueError as error:
        raise _unreadable("JSON 형식 오류") from error
    return data if isinstance(data, list) else [data]


def _xml_records(text: str) -> list[dict[str, str]]:
    try:
        root = ndm.parse_xml(text)
    except ValueError as error:
        raise _unreadable("XML 형식 오류") from error
    for kind in ("opm", "oem"):
        if root.tag == kind or root.find(f".//{kind}") is not None:
            raise CodedError(
                "elementFileWrongKind",
                f"{kind.upper()} 파일은 궤도요소가 아님 · TLE 또는 OMM 파일 필요",
                kind=kind.upper(),
            )
    messages = [root] if root.tag == "omm" else root.findall(".//omm")
    return [ndm.leaf_values(message) for message in messages]


def _csv_records(text: str) -> list[dict[str, str]]:
    return [dict(row) for row in csv.DictReader(io.StringIO(text))]


def _from_fields(index: int, fields: Any) -> ParsedRecord:
    name = str(fields.get("OBJECT_NAME") or "").strip() if isinstance(fields, dict) else ""
    try:
        if not isinstance(fields, dict):
            raise ValueError("an OMM record must be an object")
        omm = normalize_omm(_usable(fields), "user").omm
        check_sgp4(omm)
    except (KeyError, ValueError, InvalidOmm):
        return ParsedRecord(index, name, None, "omm")
    return ParsedRecord(index, omm["OBJECT_NAME"], omm, "omm")


def _from_tle(index: int, name: str | None, line1: str, line2: str) -> ParsedRecord:
    try:
        omm = normalize_omm(tle_to_omm(line1, line2, name), "user").omm
        check_sgp4(omm)
    except (ValueError, InvalidOmm):
        return ParsedRecord(index, (name or line1)[:MAX_NAME_LENGTH], None, "tle")
    return ParsedRecord(index, omm["OBJECT_NAME"], omm, "tle")


def parse_element_file(text: str) -> tuple[FileFormat, list[ParsedRecord]]:
    """Read every record of an element file.

    A record that is malformed or that SGP4 rejects is kept with ``omm=None`` so the caller
    can say which ones were left out; only a file that cannot be read at all is an error.

    Args:
        text: Decoded file contents.

    Returns:
        The detected encoding and the records in file order.

    Raises:
        CodedError: ``elementFileUnreadable`` (no records, or broken JSON/XML),
            ``elementFileWrongKind`` (an OPM or OEM), or ``elementFileTooManyRecords``.
    """
    text = text.removeprefix("﻿")
    file_format = detect_format(text)
    if file_format == "tle":
        raw: list[Any] = split_tle_records(text)
    elif file_format == "json":
        raw = _json_records(text)
    elif file_format == "xml":
        raw = _xml_records(text)
    elif file_format == "csv":
        raw = _csv_records(text)
    else:
        raw = ndm.split_kvn_messages(ndm.kvn_pairs(text), "CCSDS_OMM_VERS")
    if not raw:
        raise _unreadable("파일에 궤도요소 없음")
    if len(raw) > MAX_ELEMENT_FILE_RECORDS:
        raise CodedError(
            "elementFileTooManyRecords",
            f"궤도요소 {len(raw):,}건이 최대 {MAX_ELEMENT_FILE_RECORDS:,}건 초과",
            count=len(raw),
            max=MAX_ELEMENT_FILE_RECORDS,
        )
    if file_format == "tle":
        records = [_from_tle(i, *record) for i, record in enumerate(raw)]
    else:
        records = [_from_fields(i, fields) for i, fields in enumerate(raw)]
    return file_format, records


def _numbered(base: str, number: int) -> str:
    if number == 1:
        return base
    suffix = f" ({number})"
    return base[: MAX_NAME_LENGTH - len(suffix)].rstrip() + suffix


def plan_import(records: list[ParsedRecord], existing: dict[str, tuple[int, str]]) -> ImportPlan:
    """Decide the stored name of each record, given the names already in use.

    Names are unique, and a file is often imported twice. A record whose name is taken by
    the same elements (same catalog number and epoch) is a duplicate and is left out; a
    record whose name is taken by different elements gets `` (2)``, `` (3)`` and so on.

    Args:
        records: Parsed records, usable or not.
        existing: Stored names mapped to ``(NORAD_CAT_ID, EPOCH)``.
    """
    taken = dict(existing)
    plan = ImportPlan([], [])
    for record in records:
        if record.omm is None:
            plan.skipped.append((record.index, record.name, "invalid"))
            continue
        identity = (int(record.omm["NORAD_CAT_ID"]), str(record.omm["EPOCH"]))
        base = record.name[:MAX_NAME_LENGTH].strip() or f"NORAD {identity[0]}"
        number = 1
        while (name := _numbered(base, number)) in taken and taken[name] != identity:
            number += 1
        if name in taken:
            plan.skipped.append((record.index, name, "duplicate"))
            continue
        taken[name] = identity
        plan.create.append((name, record.omm, record.input_format))
    return plan
