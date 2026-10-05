from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import sgp4
from sgp4.api import Satrec
from sgp4.exporter import export_omm

from soda.gp.models import normalize_omm
from soda.orbit.propagation import OrbitSource, choose, run
from soda.orbit.propagator import (
    MAX_SAMPLES,
    PropagationRequestError,
    ephemeris_from_gcrs,
    orbit_summary,
    propagate,
    satellite_from_omm,
    tle_lines,
)

VALLADO_DIR = Path(sgp4.__file__).parent

# OrbitView SGP4Validation.test.ts case (MIT, OrbitView Contributors).
ORBITVIEW_ISS = (
    "1 25544U 98067A   23351.58334491  .00016717  00000-0  30142-3 0  9999",
    "2 25544  51.6416 250.7541 0004124 163.7645 282.8447 15.49520176430335",
)


def omm_from_tle(line1: str, line2: str) -> dict:
    fields = export_omm(Satrec.twoline2rv(line1, line2), "TEST")
    return normalize_omm(fields, "test").omm


def vallado_cases() -> list[tuple[str, str, list[list[float]]]]:
    """Satellites 00005 and 06251 with their C++ reference TEME positions (km)."""
    tle = (VALLADO_DIR / "SGP4-VER.TLE").read_text().splitlines()
    reference = (VALLADO_DIR / "tcppver.out").read_text().splitlines()
    cases = []
    for satnum in ("00005", "06251"):
        line1 = next(line for line in tle if line.startswith(f"1 {satnum}"))
        line2 = next(line for line in tle if line.startswith(f"2 {satnum}"))
        header = [satnum.lstrip("0"), "xx"]
        start = next(i for i, line in enumerate(reference) if line.split() == header)
        rows = []
        for line in reference[start + 1 :]:
            parts = line.split()
            if not parts or parts[-1] == "xx":
                break
            rows.append([float(value) for value in parts[:4]])
        cases.append((line1, line2[:69], rows))
    return cases


@pytest.mark.parametrize(("line1", "line2", "rows"), vallado_cases())
def test_omm_path_matches_vallado_reference(line1, line2, rows):
    model = satellite_from_omm(omm_from_tle(line1, line2)).model
    for tsince, *expected in rows:
        error, position, _ = model.sgp4_tsince(tsince)
        assert error == 0
        assert np.allclose(position, expected, atol=1e-3), tsince


def test_orbitview_iss_case_ranges():
    omm = omm_from_tle(*ORBITVIEW_ISS)
    start = datetime(2023, 12, 17, 14, tzinfo=UTC)
    ephemeris = propagate(omm, start, start + timedelta(hours=1), 60)
    radius_km = np.linalg.norm(ephemeris.fixed_m[0]) / 1000
    assert 6700 < radius_km < 6850
    assert 350 < ephemeris.alt_km[0] < 450
    assert abs(ephemeris.lat_deg[0]) <= 52
    speed_km_s = np.linalg.norm(ephemeris.fixed_velocity_m_s[0]) / 1000
    assert 6.9 < speed_km_s < 7.9
    moved_km = np.linalg.norm(ephemeris.inertial_m[-1] - ephemeris.inertial_m[0]) / 1000
    assert 1000 < moved_km < 20000


def test_frames_are_consistent(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    ephemeris = propagate(omm, start, start + timedelta(minutes=93), 30)
    assert len(ephemeris) == 187
    assert ephemeris.valid.all()
    np.testing.assert_allclose(
        np.linalg.norm(ephemeris.fixed_m, axis=1),
        np.linalg.norm(ephemeris.inertial_m, axis=1),
        rtol=1e-9,
    )
    x, y, _ = ephemeris.fixed_m.T
    np.testing.assert_allclose(np.degrees(np.arctan2(y, x)), ephemeris.lon_deg, atol=1e-6)
    assert ephemeris.warnings == []


def test_gcrs_states_give_the_same_frames_as_sgp4(iss_record):
    """Any propagator that hands over GCRS states lands in the frames the SGP4 path uses."""
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    sgp4_path = propagate(omm, start, start + timedelta(minutes=93), 30)
    assert sgp4_path.inertial_velocity_m_s is not None
    rebuilt = ephemeris_from_gcrs(
        start,
        30,
        sgp4_path.times,
        sgp4_path.inertial_m,
        sgp4_path.inertial_velocity_m_s,
        np.ones(len(sgp4_path), dtype=bool),
        [],
    )
    np.testing.assert_allclose(rebuilt.fixed_m, sgp4_path.fixed_m, atol=1e-6)
    np.testing.assert_allclose(rebuilt.fixed_velocity_m_s, sgp4_path.fixed_velocity_m_s, atol=1e-9)
    np.testing.assert_allclose(rebuilt.lat_deg, sgp4_path.lat_deg, atol=1e-12)
    np.testing.assert_allclose(rebuilt.lon_deg, sgp4_path.lon_deg, atol=1e-12)
    np.testing.assert_allclose(rebuilt.alt_km, sgp4_path.alt_km, atol=1e-9)
    assert rebuilt.valid.all()

    broken = sgp4_path.inertial_m.copy()
    broken[3] = np.nan
    marked = ephemeris_from_gcrs(
        start,
        30,
        sgp4_path.times,
        broken,
        sgp4_path.inertial_velocity_m_s,
        np.ones(len(sgp4_path), dtype=bool),
        [],
    )
    assert list((~marked.valid).nonzero()[0]) == [3]


def test_propagator_choice(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    source = OrbitSource("omm", omm)
    default = run(source, start, start + timedelta(minutes=10), 60)
    explicit = run(source, start, start + timedelta(minutes=10), 60, "sgp4")
    assert default.propagator == explicit.propagator == "sgp4"
    assert default.force_model is None
    np.testing.assert_array_equal(default.ephemeris.fixed_m, explicit.ephemeris.fixed_m)
    assert choose("omm", None) == "sgp4"
    with pytest.raises(PropagationRequestError) as caught:
        choose("omm", "ephemeris")
    assert caught.value.code == "propagatorNotAllowed"
    assert caught.value.params == {"kind": "omm", "propagator": "ephemeris"}


def test_warns_far_from_epoch(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 10, 1, tzinfo=UTC)
    ephemeris = propagate(omm, start, start + timedelta(hours=1), 60)
    assert ephemeris.warnings[0]["code"] == "elementsFarFromEpoch"
    assert ephemeris.warnings[0]["params"]["days"] >= 7


@pytest.mark.parametrize(
    ("hours", "step", "code"),
    [
        (0, 30, "endBeforeStart"),
        (24 * 31, 600, "spanTooLong"),
        (1, 0.5, "stepTooSmall"),
        (24 * 30, 10, "tooManySamples"),
    ],
)
def test_request_limits(iss_record, hours, step, code):
    omm = normalize_omm(iss_record, "celestrak").omm
    start = datetime(2026, 9, 16, tzinfo=UTC)
    with pytest.raises(PropagationRequestError) as caught:
        propagate(omm, start, start + timedelta(hours=hours), step)
    assert caught.value.code == code
    assert MAX_SAMPLES == 100_000


def test_summary_and_tle_rendering(iss_record):
    omm = normalize_omm(iss_record, "celestrak").omm
    summary = orbit_summary(omm)
    assert summary["category"] == "LEO"
    assert summary["period_min"] == pytest.approx(92.96, abs=0.01)
    assert 400 < summary["perigee_alt_km"] < summary["apogee_alt_km"] < 440
    assert tle_lines(omm)[1].startswith("2 25544  51.6310")
    assert tle_lines(dict(omm, NORAD_CAT_ID=100123))[0].startswith("1 A0123U")
    assert tle_lines(dict(omm, NORAD_CAT_ID=400000)) is None
    assert satellite_from_omm(dict(omm, NORAD_CAT_ID=400000)).model.satnum == 0
