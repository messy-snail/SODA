"""OEM ephemerides: interpolation, parsing, the round trip through a file, and the span."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from soda.errors import CodedError
from soda.gp.models import normalize_omm
from soda.orbit import oem
from soda.orbit.interpolate import clamp_degree, lagrange
from soda.orbit.oem import interpolate_ephemeris, parse_oem, write_oem
from soda.orbit.propagator import PropagationRequestError, propagate

START = datetime(2026, 9, 16, tzinfo=UTC)


@pytest.fixture
def sgp4_run(iss_record):
    """Three hours of the ISS at 60 s, and the same OMM for denser reference samples."""
    omm = normalize_omm(iss_record, "celestrak").omm
    return omm, propagate(omm, START, START + timedelta(hours=3), 60)


def test_lagrange_reproduces_polynomials_and_smooth_functions():
    nodes = np.array([0.0, 1.0, 2.5, 3.0, 4.2, 5.0, 6.1, 7.0, 8.4, 9.0])
    cubic = np.column_stack([nodes**3 - 2 * nodes, 4 * nodes**2 + 1])
    query = np.array([0.0, 0.3, 2.5, 4.9, 8.9, 9.0])
    expected = np.column_stack([query**3 - 2 * query, 4 * query**2 + 1])
    np.testing.assert_allclose(lagrange(nodes, cubic, query, 3), expected, atol=1e-9)
    np.testing.assert_allclose(lagrange(nodes, cubic, query, 7), expected, atol=1e-8)

    dense = np.linspace(0.0, 6.0, 61)
    wave = np.column_stack([np.sin(dense), np.cos(dense)])
    between = np.linspace(0.05, 5.95, 200)
    result = lagrange(dense, wave, between, 7)
    np.testing.assert_allclose(result[:, 0], np.sin(between), atol=1e-12)
    with pytest.raises(ValueError):
        lagrange(nodes[:3], cubic[:3], query[:1], 7)
    assert [clamp_degree(d, n) for d, n in ((7, 100), (7, 4), (0, 10), (50, 100))] == [7, 3, 1, 11]


def test_round_trip_through_an_oem_file(sgp4_run):
    omm, coarse = sgp4_run
    text = write_oem(coarse, "ISS (ZARYA)", "1998-067A")
    stored = parse_oem(text)
    assert (stored.name, stored.object_id, stored.frame) == ("ISS (ZARYA)", "1998-067A", "GCRF")
    assert (stored.start, stored.stop) == (START, START + timedelta(hours=3))
    assert stored.samples.shape == (181, 7) and stored.segments == ((0, 181),)
    assert stored.degree == 7
    np.testing.assert_allclose(stored.samples[:, 1:4], coarse.inertial_m, atol=1e-5)

    # Sampled five times as densely, the table still follows the orbit it was made from.
    fine = interpolate_ephemeris(stored, START, START + timedelta(hours=3), 12)
    reference = propagate(omm, START, START + timedelta(hours=3), 12)
    assert fine.valid.all() and fine.warnings == []
    separation = np.linalg.norm(fine.fixed_m - reference.fixed_m, axis=1)
    assert separation.max() < 1.0
    np.testing.assert_allclose(fine.lat_deg, reference.lat_deg, atol=1e-5)
    assert fine.inertial_velocity_m_s is not None and reference.inertial_velocity_m_s is not None
    np.testing.assert_allclose(
        fine.inertial_velocity_m_s, reference.inertial_velocity_m_s, atol=1e-3
    )
    assert parse_oem(text, name="renamed").name == "renamed"


def test_window_outside_the_stored_span(sgp4_run):
    _, coarse = sgp4_run
    stored = parse_oem(write_oem(coarse, "ISS"))
    partial = interpolate_ephemeris(
        stored, START - timedelta(minutes=10), START + timedelta(minutes=10), 60
    )
    assert list(partial.valid) == [False] * 10 + [True] * 11
    assert [w["code"] for w in partial.warnings] == ["ephemerisOutsideSpan"]
    assert partial.warnings[0]["params"] == {"count": 10}

    with pytest.raises(PropagationRequestError) as caught:
        interpolate_ephemeris(stored, START + timedelta(days=1), START + timedelta(days=2), 60)
    assert caught.value.code == "ephemerisNoOverlap"
    assert caught.value.params == {"start": "2026-09-16T00:00:00Z", "end": "2026-09-16T03:00:00Z"}
    with pytest.raises(PropagationRequestError) as caught:
        interpolate_ephemeris(stored, START, START - timedelta(hours=1), 60)
    assert caught.value.code == "endBeforeStart"


def _kvn(rows: list[str], frame: str = "EME2000", time_system: str = "UTC", extra: str = "") -> str:
    return (
        "CCSDS_OEM_VERS = 2.0\nCREATION_DATE = 2026-09-16T00:00:00\nORIGINATOR = TEST\n"
        "META_START\nOBJECT_NAME = TEST-SAT\nOBJECT_ID = 2026-001A\nCENTER_NAME = EARTH\n"
        f"REF_FRAME = {frame}\nTIME_SYSTEM = {time_system}\nSTART_TIME = 2026-09-16T00:00:00\n"
        f"STOP_TIME = 2026-09-16T01:00:00\n{extra}META_STOP\nCOMMENT data follows\n"
        + "\n".join(rows)
        + "\n"
    )


def _rows(count: int, first: int = 0, step_s: int = 60) -> list[str]:
    return [
        f"2026-09-16T00:{(first + i) * step_s // 60:02d}:{(first + i) * step_s % 60:02d} "
        f"{7000 + i} 0 0 0 7.5 0"
        for i in range(count)
    ]


def test_segments_are_not_interpolated_across():
    second = _kvn(_rows(10, first=20)).split("META_START", 1)[1]
    text = _kvn(_rows(10), extra="INTERPOLATION_DEGREE = 5\n") + "META_START" + second
    stored = parse_oem(text)
    assert stored.segments == ((0, 10), (10, 20)) and stored.degree == 5
    assert stored.stop == START + timedelta(minutes=29)
    sampled = interpolate_ephemeris(stored, START, START + timedelta(minutes=29), 60)
    assert list((~sampled.valid).nonzero()[0]) == list(range(10, 20))
    np.testing.assert_allclose(sampled.inertial_m[25], [7005e3, 0, 0], atol=1e-6)


def test_xml_and_covariance_blocks_are_read():
    vectors = "".join(
        f"<stateVector><EPOCH>2026-09-16T00:0{i}:00Z</EPOCH><X>{7000 + i}</X><Y>0</Y><Z>0</Z>"
        "<X_DOT>0</X_DOT><Y_DOT>7.5</Y_DOT><Z_DOT>0</Z_DOT></stateVector>"
        for i in range(5)
    )
    xml = (
        '<?xml version="1.0"?><oem xmlns="urn:ccsds:schema:ndmxml" version="2.0"><header/>'
        "<body><segment><metadata><OBJECT_NAME>XML-SAT</OBJECT_NAME><OBJECT_ID>X</OBJECT_ID>"
        "<CENTER_NAME>EARTH</CENTER_NAME><REF_FRAME>GCRF</REF_FRAME>"
        f"<TIME_SYSTEM>UTC</TIME_SYSTEM></metadata><data>{vectors}</data></segment></body></oem>"
    )
    stored = parse_oem(xml)
    assert (stored.name, len(stored.samples), stored.degree) == ("XML-SAT", 5, 4)
    np.testing.assert_allclose(stored.samples[2, 1:], [7002e3, 0, 0, 0, 7500, 0])

    covariance = "COVARIANCE_START\nEPOCH = 2026-09-16T00:00:00\n1.0\n2.0 3.0\nCOVARIANCE_STOP\n"
    with_extras = _kvn([row + " 0.1 0.2 0.3" for row in _rows(4)]) + covariance
    assert len(parse_oem(with_extras).samples) == 4


def test_itrf_ephemeris_is_converted(sgp4_run):
    _, coarse = sgp4_run
    rows = [
        f"{(START + timedelta(seconds=60 * i)).strftime('%Y-%m-%dT%H:%M:%S')} "
        + " ".join(
            f"{value / 1000:.9f}" for value in (*coarse.fixed_m[i], *coarse.fixed_velocity_m_s[i])
        )
        for i in range(30)
    ]
    stored = parse_oem(_kvn(rows, frame="ITRF2014"))
    assert stored.frame == "ITRF2014"
    np.testing.assert_allclose(stored.samples[:, 1:4], coarse.inertial_m[:30], atol=1e-3)
    assert coarse.inertial_velocity_m_s is not None
    np.testing.assert_allclose(stored.samples[:, 4:], coarse.inertial_velocity_m_s[:30], atol=1e-3)


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("", "oemInvalid"),
        ("CCSDS_OMM_VERS = 2.0\nOBJECT_NAME = X\n", "oemInvalid"),
        (_kvn([]), "oemInvalid"),
        (_kvn(_rows(1)), "oemInvalid"),
        (_kvn(list(reversed(_rows(4)))), "oemInvalid"),
        (_kvn(["2026-09-16T00:00:00 7000 0 0"]), "oemInvalid"),
        (_kvn(["2026-09-16T00:00:00 a b c d e f", *_rows(3, first=1)]), "oemInvalid"),
        (_kvn(_rows(4)).replace("CENTER_NAME = EARTH", "CENTER_NAME = MARS"), "oemInvalid"),
        (_kvn(_rows(4)).replace("OBJECT_NAME = TEST-SAT\n", ""), "oemInvalid"),
        (_kvn(_rows(4), time_system="TAI"), "oemTimeSystemUnsupported"),
        (_kvn(_rows(4), frame="MCI"), "oemFrameUnsupported"),
        ('<!DOCTYPE oem [<!ENTITY a "b">]><oem/>', "oemInvalid"),
    ],
)
def test_bad_files_are_rejected(text, code):
    with pytest.raises(CodedError) as caught:
        parse_oem(text)
    assert caught.value.code == code


def test_sample_limit(monkeypatch):
    monkeypatch.setattr(oem, "MAX_OEM_SAMPLES", 5)
    assert len(parse_oem(_kvn(_rows(5))).samples) == 5
    with pytest.raises(CodedError) as caught:
        parse_oem(_kvn(_rows(6)))
    assert caught.value.code == "oemTooManySamples"
    assert caught.value.params == {"count": 6, "max": 5}
