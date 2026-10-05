"""Element files: every encoding ends up as the same normalized OMM records."""

import json

import pytest

from soda.errors import CodedError
from soda.gp.element_files import (
    MAX_ELEMENT_FILE_RECORDS,
    ParsedRecord,
    detect_format,
    parse_element_file,
    plan_import,
)
from soda.gp.models import normalize_omm
from soda.gp.ndm import parse_epoch
from soda.gp.tle import split_tle_records
from soda.orbit.propagator import tle_lines

OMM_KEYS = (
    "OBJECT_NAME",
    "OBJECT_ID",
    "EPOCH",
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
    "EPHEMERIS_TYPE",
    "CLASSIFICATION_TYPE",
    "NORAD_CAT_ID",
    "ELEMENT_SET_NO",
    "REV_AT_EPOCH",
    "BSTAR",
    "MEAN_MOTION_DOT",
    "MEAN_MOTION_DDOT",
)


@pytest.fixture
def records(iss_record) -> list[dict]:
    """Two satellites: the ISS and a copy under another catalog number and name."""
    other = {**iss_record, "OBJECT_NAME": "TWIN", "NORAD_CAT_ID": 40000, "INCLINATION": 97.5}
    return [iss_record, other]


def _tle(record: dict) -> list[str]:
    lines = tle_lines(normalize_omm(record, "user").omm)
    assert lines is not None
    return list(lines)


def _kvn(record: dict, epoch: str | None = None) -> str:
    fields = {
        "CCSDS_OMM_VERS": "2.0",
        "CREATION_DATE": "2026-09-16T00:00:00",
        "ORIGINATOR": "TEST",
        "CENTER_NAME": "EARTH",
        "REF_FRAME": "TEME",
        "TIME_SYSTEM": "UTC",
        "MEAN_ELEMENT_THEORY": "SGP4",
        **{key: record[key] for key in OMM_KEYS},
    }
    if epoch:
        fields["EPOCH"] = epoch
    return "COMMENT generated for a test\n" + "".join(f"{k} = {v}\n" for k, v in fields.items())


def _xml(records: list[dict], doctype: str = "") -> str:
    def omm(record: dict) -> str:
        tags = "".join(f"<{key}>{record[key]}</{key}>" for key in OMM_KEYS)
        return (
            '<omm id="CCSDS_OMM_VERS" version="2.0"><header><ORIGINATOR>TEST</ORIGINATOR>'
            "</header><body><segment><metadata><TIME_SYSTEM>UTC</TIME_SYSTEM>"
            "<MEAN_ELEMENT_THEORY>SGP4</MEAN_ELEMENT_THEORY></metadata>"
            f"<data>{tags}</data></segment></body></omm>"
        )

    body = "".join(omm(record) for record in records)
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>{doctype}'
        f'<ndm xmlns="urn:ccsds:schema:ndmxml">{body}</ndm>'
    )


def _csv(records: list[dict]) -> str:
    rows = [",".join(OMM_KEYS)] + [",".join(str(r[key]) for key in OMM_KEYS) for r in records]
    return "\n".join(rows) + "\n"


def _expected(records: list[dict]) -> list[dict]:
    return [normalize_omm(record, "user").omm for record in records]


def test_every_omm_encoding_gives_the_same_records(records):
    files = {
        "json": json.dumps(records),
        "xml": _xml(records),
        "kvn": "\n".join(_kvn(record) for record in records),
        "csv": _csv(records),
    }
    for expected_format, text in files.items():
        file_format, parsed = parse_element_file(text)
        assert file_format == expected_format
        assert [record.omm for record in parsed] == _expected(records), expected_format
        assert [record.name for record in parsed] == ["ISS (ZARYA)", "TWIN"]
        assert {record.input_format for record in parsed} == {"omm"}


def test_tle_file_mixes_two_and_three_line_records(records):
    iss, twin = (_tle(record) for record in records)
    text = "\n".join(["0 ISS (ZARYA)", *iss, "", *twin, "TWIN", *twin]) + "\n"
    file_format, parsed = parse_element_file("﻿" + text)
    assert file_format == "tle"
    assert [record.name for record in parsed] == ["ISS (ZARYA)", "NORAD 40000", "TWIN"]
    assert [record.omm["NORAD_CAT_ID"] for record in parsed] == [25544, 40000, 40000]
    assert {record.input_format for record in parsed} == {"tle"}


def test_a_bad_record_does_not_stop_the_file(records):
    iss, twin = (_tle(record) for record in records)
    broken = iss[0][:-1] + str((int(iss[0][-1]) + 1) % 10)  # wrong checksum
    # A line right before a TLE is its name, so only "stray" belongs to no record.
    lines = ["BAD", broken, iss[1], "stray", "TWIN B", *twin]
    _, parsed = parse_element_file("\n".join(lines))
    assert [record.omm is None for record in parsed] == [True, True, False]
    assert [record.name for record in parsed] == ["BAD", "stray", "TWIN B"]
    assert parsed[2].omm["NORAD_CAT_ID"] == 40000

    bad_json = json.dumps([records[0], {**records[1], "ECCENTRICITY": 1.5}, "text"])
    _, parsed = parse_element_file(bad_json)
    assert [record.omm is None for record in parsed] == [False, True, True]
    assert parsed[1].name == "TWIN"


def test_split_tle_records_keeps_stray_lines(records):
    iss = _tle(records[0])
    assert split_tle_records("\n".join([*iss, "junk"])) == [
        (None, iss[0], iss[1]),
        (None, "junk", ""),
    ]


@pytest.mark.parametrize(
    ("change", "usable"),
    [
        ({"MEAN_ELEMENT_THEORY": "SGP/SGP4"}, True),
        ({"MEAN_ELEMENT_THEORY": "SGP4-XP"}, False),
        ({"MEAN_ELEMENT_THEORY": "DSST"}, False),
        ({"TIME_SYSTEM": "TAI"}, False),
        ({"BTERM": "0.02"}, False),
        ({"EPOCH": "2026-258T21:14:23.428032"}, True),
        ({"EPOCH": "yesterday"}, False),
    ],
)
def test_omm_metadata_checks(iss_record, change, usable):
    _, parsed = parse_element_file(json.dumps({**iss_record, **change}))
    assert (parsed[0].omm is not None) == usable
    if usable:
        assert parsed[0].omm == normalize_omm(iss_record, "user").omm


def test_day_of_year_epoch():
    assert parse_epoch("2026-258T21:14:23.5Z") == parse_epoch("2026-09-15T21:14:23.5")
    with pytest.raises(ValueError):
        parse_epoch("2026-400T00:00:00")


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("", "elementFileUnreadable"),
        ("   \n", "elementFileUnreadable"),
        ("{not json", "elementFileUnreadable"),
        ("[]", "elementFileUnreadable"),
        ("<ndm><omm></ndm>", "elementFileUnreadable"),
        ("<ndm></ndm>", "elementFileUnreadable"),
        ("CCSDS_OPM_VERS = 2.0\nOBJECT_NAME = X\n", "elementFileWrongKind"),
        ("CCSDS_OEM_VERS = 2.0\nOBJECT_NAME = X\n", "elementFileWrongKind"),
        ('<opm id="CCSDS_OPM_VERS" version="2.0"></opm>', "elementFileWrongKind"),
        ("<ndm><oem></oem></ndm>", "elementFileWrongKind"),
    ],
)
def test_unreadable_files(text, code):
    with pytest.raises(CodedError) as caught:
        parse_element_file(text)
    assert caught.value.code == code


def test_xml_document_type_is_refused(records):
    bomb = '<!DOCTYPE ndm [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>'
    with pytest.raises(CodedError) as caught:
        parse_element_file(_xml(records, doctype=bomb))
    assert caught.value.code == "elementFileUnreadable"


def test_record_limit(iss_record):
    many = json.dumps([iss_record] * (MAX_ELEMENT_FILE_RECORDS + 1))
    with pytest.raises(CodedError) as caught:
        parse_element_file(many)
    assert caught.value.code == "elementFileTooManyRecords"
    assert caught.value.params == {
        "count": MAX_ELEMENT_FILE_RECORDS + 1,
        "max": MAX_ELEMENT_FILE_RECORDS,
    }
    assert len(parse_element_file(json.dumps([iss_record] * MAX_ELEMENT_FILE_RECORDS))[1]) == 500


def test_detect_format():
    assert detect_format("  [1]") == "json"
    assert detect_format("\n<ndm/>") == "xml"
    assert detect_format("CCSDS_OMM_VERS = 2.0") == "kvn"
    assert detect_format("OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION\n") == "csv"
    assert detect_format("ISS\n1 25544U\n2 25544") == "tle"


def test_plan_import_names(records):
    omm, twin = _expected(records)
    later = {**omm, "EPOCH": "2026-09-16T21:14:23.428032"}
    parsed = [
        ParsedRecord(0, "ISS (ZARYA)", omm, "tle"),
        ParsedRecord(1, "ISS (ZARYA)", omm, "tle"),  # same elements again
        ParsedRecord(2, "ISS (ZARYA)", later, "omm"),  # same name, newer elements
        ParsedRecord(3, "broken", None, "tle"),
        ParsedRecord(4, "   ", twin, "omm"),
        ParsedRecord(5, "N" * 80, twin, "omm"),
        ParsedRecord(6, "N" * 80, omm, "omm"),
    ]
    plan = plan_import(parsed, {"TWIN": (1, "x")})
    assert [(name, fmt) for name, _, fmt in plan.create] == [
        ("ISS (ZARYA)", "tle"),
        ("ISS (ZARYA) (2)", "omm"),
        ("NORAD 40000", "omm"),
        ("N" * 60, "omm"),
        ("N" * 56 + " (2)", "omm"),
    ]
    assert plan.skipped == [(1, "ISS (ZARYA)", "duplicate"), (3, "broken", "invalid")]

    again = plan_import(
        parsed[:3], {name: (o["NORAD_CAT_ID"], o["EPOCH"]) for name, o, _ in plan.create}
    )
    assert again.create == []
    assert [reason for _, _, reason in again.skipped] == ["duplicate"] * 3
