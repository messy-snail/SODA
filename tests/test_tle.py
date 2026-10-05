"""TLE/OMM input from the user: conversion, format detection, and rejection."""

import json

import pytest

from soda.errors import CodedError
from soda.gp.models import normalize_omm
from soda.gp.tle import parse_custom_elements, tle_to_omm
from soda.orbit.propagator import tle_lines


@pytest.fixture
def iss_tle(iss_record) -> tuple[str, str]:
    lines = tle_lines(normalize_omm(iss_record, "celestrak").omm)
    assert lines is not None
    return lines


def test_tle_round_trips_through_omm(iss_tle):
    omm = normalize_omm(tle_to_omm(*iss_tle), "user").omm
    assert tle_lines(omm) == iss_tle


def test_tle_fields_match_the_celestrak_record(iss_tle, iss_record):
    omm = tle_to_omm(*iss_tle, name="ISS (ZARYA)")
    assert omm["OBJECT_NAME"] == "ISS (ZARYA)"
    assert omm["OBJECT_ID"] == "1998-067A"
    assert omm["EPOCH"] == iss_record["EPOCH"]
    assert omm["NORAD_CAT_ID"] == 25544
    assert (omm["ELEMENT_SET_NO"], omm["REV_AT_EPOCH"]) == (999, 58581)
    assert omm["CLASSIFICATION_TYPE"] == "U"
    # Tolerances are the resolution of each TLE column.
    for key, resolution in (
        ("MEAN_MOTION", 1e-8),
        ("ECCENTRICITY", 1e-7),
        ("INCLINATION", 1e-4),
        ("RA_OF_ASC_NODE", 1e-4),
        ("ARG_OF_PERICENTER", 1e-4),
        ("MEAN_ANOMALY", 1e-4),
        ("MEAN_MOTION_DOT", 1e-8),
    ):
        assert omm[key] == pytest.approx(iss_record[key], abs=resolution), key
    # The TLE keeps five significant digits of B*.
    assert omm["BSTAR"] == pytest.approx(iss_record["BSTAR"], rel=1e-4)
    assert omm["MEAN_MOTION_DDOT"] == 0


def test_second_derivative_units(iss_tle):
    """nddot goes through the same rev/day^3 conversion sgp4's exporter uses."""
    line1 = iss_tle[0][:44] + " 12345-5" + iss_tle[0][52:68]
    line1 += str(sum(int(c) if c.isdigit() else c == "-" for c in line1) % 10)
    omm = tle_to_omm(line1, iss_tle[1])
    assert omm["MEAN_MOTION_DDOT"] == pytest.approx(0.12345e-5, rel=1e-9)


def test_two_lines_are_named_after_the_catalog_number(iss_tle):
    omm, input_format = parse_custom_elements("\n".join(iss_tle))
    assert input_format == "tle"
    assert omm["OBJECT_NAME"] == "NORAD 25544"
    assert omm["EPOCH"] == "2026-09-15T21:14:23.428032"


@pytest.mark.parametrize("name_line", ["ISS (ZARYA)", "0 ISS (ZARYA)"])
def test_three_lines_carry_a_name(iss_tle, name_line):
    text = f"  {name_line}\r\n{iss_tle[0]}\r\n\n{iss_tle[1]}  \n"
    omm, input_format = parse_custom_elements(text)
    assert input_format == "tle"
    assert omm["OBJECT_NAME"] == "ISS (ZARYA)"


def test_omm_json_object_and_single_item_list(iss_record):
    as_object, fmt = parse_custom_elements(json.dumps(iss_record))
    assert fmt == "omm"
    as_list, fmt = parse_custom_elements(f"  {json.dumps([iss_record])}\n")
    assert fmt == "omm"
    assert as_object == as_list == normalize_omm(iss_record, "user").omm


def test_omm_json_with_space_track_strings(iss_record):
    stringly = {key: str(value) for key, value in iss_record.items()}
    omm, _ = parse_custom_elements(json.dumps(stringly))
    assert omm["NORAD_CAT_ID"] == 25544 and omm["MEAN_MOTION"] == iss_record["MEAN_MOTION"]


def test_alpha5_catalog_numbers(iss_record):
    lines = tle_lines(normalize_omm(dict(iss_record, NORAD_CAT_ID=100123), "celestrak").omm)
    assert lines[0].startswith("1 A0123U")
    omm, _ = parse_custom_elements("\n".join(lines))
    assert omm["NORAD_CAT_ID"] == 100123
    assert tle_lines(omm) == lines


def _bad_checksum(line: str) -> str:
    return line[:-1] + str((int(line[-1]) + 1) % 10)


@pytest.mark.parametrize(
    "make_text",
    [
        lambda tle, rec: "",
        lambda tle, rec: tle[0],
        lambda tle, rec: "garbage\nmore garbage",
        lambda tle, rec: "\n".join(["A", "B", *tle]),
        lambda tle, rec: f"{tle[1]}\n{tle[0]}",
        # sgp4 itself ignores the checksum; a typo would otherwise pass silently.
        lambda tle, rec: f"{_bad_checksum(tle[0])}\n{tle[1]}",
        lambda tle, rec: f"{tle[0]}\n{tle[1][:-2]}",
        lambda tle, rec: "{not json",
        lambda tle, rec: "[]",
        lambda tle, rec: json.dumps([rec, rec]),
        lambda tle, rec: json.dumps(["x"]),
        lambda tle, rec: json.dumps({k: v for k, v in rec.items() if k != "MEAN_MOTION"}),
        lambda tle, rec: json.dumps(dict(rec, ECCENTRICITY=1.5)),
        lambda tle, rec: json.dumps(dict(rec, EPOCH="yesterday")),
    ],
)
def test_invalid_input_is_a_coded_error(iss_tle, iss_record, make_text):
    with pytest.raises(CodedError) as caught:
        parse_custom_elements(make_text(iss_tle, iss_record))
    assert caught.value.code == "customElementsInvalid"


def test_mismatched_catalog_numbers_are_rejected(iss_tle, iss_record):
    other = tle_lines(normalize_omm(dict(iss_record, NORAD_CAT_ID=43013), "celestrak").omm)
    with pytest.raises(CodedError):
        parse_custom_elements(f"{iss_tle[0]}\n{other[1]}")
