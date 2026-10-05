"""State vectors: OPM parsing, frame conversion, the checks, and the osculating summary."""

from datetime import UTC, datetime, timedelta
from math import sqrt

import numpy as np
import pytest

from soda.errors import CodedError
from soda.gp.models import normalize_omm
from soda.orbit.frames import frame_family, to_gcrs
from soda.orbit.hpop.constants import GM_EARTH, R_EARTH
from soda.orbit.kepler import osculating_summary
from soda.orbit.opm import build_state, parse_opm, stored_state
from soda.orbit.propagator import propagate

EPOCH = datetime(2026, 9, 16, tzinfo=UTC)
RADIUS = R_EARTH + 700e3
SPEED = sqrt(GM_EARTH / RADIUS)
POSITION = np.array([RADIUS, 0.0, 0.0])
VELOCITY = np.array([0.0, SPEED * 0.6, SPEED * 0.8])

OPM_KVN = """CCSDS_OPM_VERS = 2.0
COMMENT a test message
CREATION_DATE = 2026-09-16T00:00:00
ORIGINATOR = TEST
OBJECT_NAME = SODA-SAT
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = {frame}
TIME_SYSTEM = {time_system}
EPOCH = 2026-259T00:00:00.000
X = {x} [km]
Y = 0.000 [km]
Z = 0.000 [km]
X_DOT = 0.000 [km/s]
Y_DOT = {vy} [km/s]
Z_DOT = {vz} [km/s]
MASS = 120.5 [kg]
SOLAR_RAD_AREA = 1.2 [m**2]
SOLAR_RAD_COEFF = 1.4
DRAG_AREA = 0.9 [m**2]
DRAG_COEFF = 2.3
"""


def _kvn(**changes: str) -> str:
    fields = {
        "frame": "EME2000",
        "time_system": "UTC",
        "x": f"{RADIUS / 1000:.6f}",
        "vy": f"{VELOCITY[1] / 1000:.9f}",
        "vz": f"{VELOCITY[2] / 1000:.9f}",
    }
    return OPM_KVN.format(**{**fields, **changes})


def _xml() -> str:
    tags = {
        "X": RADIUS / 1000,
        "Y": 0,
        "Z": 0,
        "X_DOT": 0,
        "Y_DOT": float(VELOCITY[1]) / 1000,
        "Z_DOT": float(VELOCITY[2]) / 1000,
    }
    vector = "".join(f'<{key} units="km">{value!r}</{key}>' for key, value in tags.items())
    return (
        '<?xml version="1.0"?><opm xmlns="urn:ccsds:schema:ndmxml" id="CCSDS_OPM_VERS" '
        'version="2.0"><header><ORIGINATOR>TEST</ORIGINATOR></header><body><segment><metadata>'
        "<OBJECT_NAME>XML-SAT</OBJECT_NAME><OBJECT_ID>2026-002B</OBJECT_ID>"
        "<CENTER_NAME>EARTH</CENTER_NAME><REF_FRAME>GCRF</REF_FRAME>"
        "<TIME_SYSTEM>UTC</TIME_SYSTEM></metadata><data><stateVector>"
        f"<EPOCH>2026-09-16T00:00:00Z</EPOCH>{vector}</stateVector>"
        "<spacecraftParameters><MASS>300</MASS></spacecraftParameters>"
        "</data></segment></body></opm>"
    )


def test_opm_kvn_and_xml_give_the_state():
    kvn = parse_opm(_kvn())
    assert (kvn.name, kvn.object_id, kvn.frame, kvn.epoch) == (
        "SODA-SAT",
        "2026-001A",
        "EME2000",
        EPOCH,
    )
    np.testing.assert_allclose(kvn.position_m, POSITION, atol=1e-3)
    np.testing.assert_allclose(kvn.velocity_m_s, VELOCITY, atol=1e-5)
    assert kvn.spacecraft == {
        "mass_kg": 120.5,
        "drag_area_m2": 0.9,
        "cd": 2.3,
        "srp_area_m2": 1.2,
        "cr": 1.4,
    }
    assert kvn.stored()["x_m"] == pytest.approx(RADIUS, abs=1e-3)
    assert kvn.stored()["mass_kg"] == 120.5 and kvn.stored()["object_id"] == "2026-001A"

    xml = parse_opm(_xml(), name="renamed")
    assert (xml.name, xml.object_id, xml.frame) == ("renamed", "2026-002B", "GCRF")
    np.testing.assert_allclose(xml.position_m, POSITION, atol=1e-6)
    assert xml.spacecraft == {"mass_kg": 300.0}


@pytest.mark.parametrize(
    "text",
    [
        "",
        "not an opm",
        _kvn(time_system="TAI"),
        _kvn(frame="MCI"),
        _kvn(x="abc"),
        _kvn(x="6400.0"),  # 22 km up: below the re-entry height
        _kvn(vy="9.0", vz="9.0"),  # hyperbolic
        _kvn().replace("CENTER_NAME = EARTH", "CENTER_NAME = MOON"),
        _kvn().replace("EPOCH = 2026-259T00:00:00.000\n", ""),
        _kvn().replace("MASS = 120.5", "MASS = -1"),
        _kvn() + _kvn(),
        "<ndm><omm></omm></ndm>",
        '<!DOCTYPE opm [<!ENTITY a "b">]>' + _xml(),
    ],
)
def test_bad_opm_is_rejected(text):
    with pytest.raises(CodedError) as caught:
        parse_opm(text)
    assert caught.value.code == "stateVectorInvalid"


def test_frames_convert_to_gcrs(iss_record):
    """ITRF and TEME states come back to the GCRS state they describe."""
    assert frame_family("EME2000") == frame_family("gcrf") == "gcrs"
    assert frame_family("ITRF2014") == frame_family("ITRF-93") == "itrf"
    assert frame_family("TEME") == "teme" and frame_family("MCI") is None

    omm = normalize_omm(iss_record, "celestrak").omm
    ephemeris = propagate(omm, EPOCH, EPOCH + timedelta(minutes=10), 60)
    assert ephemeris.inertial_velocity_m_s is not None
    position, velocity = to_gcrs(
        "ITRF", ephemeris.times, ephemeris.fixed_m, ephemeris.fixed_velocity_m_s
    )
    np.testing.assert_allclose(position, ephemeris.inertial_m, atol=1e-6)
    np.testing.assert_allclose(velocity, ephemeris.inertial_velocity_m_s, atol=1e-4)

    single = build_state(
        "one",
        EPOCH,
        "ITRF2014",
        ephemeris.fixed_m[0],
        ephemeris.fixed_velocity_m_s[0],
    )
    np.testing.assert_allclose(single.position_m, ephemeris.inertial_m[0], atol=1e-6)
    np.testing.assert_allclose(single.velocity_m_s, ephemeris.inertial_velocity_m_s[0], atol=1e-4)

    # TEME is a rotation of a few arcminutes from GCRS: the same length, a nearby direction.
    teme_position, teme_velocity = to_gcrs("TEME", ephemeris.times[0], POSITION, VELOCITY)
    assert np.linalg.norm(teme_position) == pytest.approx(RADIUS, rel=1e-12)
    assert np.linalg.norm(teme_velocity) == pytest.approx(SPEED, rel=1e-12)
    assert 1e3 < np.linalg.norm(teme_position - POSITION) < 100e3
    with pytest.raises(ValueError):
        to_gcrs("MCI", ephemeris.times[0], POSITION, VELOCITY)


def test_build_state_checks():
    good = build_state("  padded  ", EPOCH.replace(tzinfo=None), "gcrf", POSITION, VELOCITY)
    assert (good.name, good.frame, good.epoch) == ("padded", "GCRF", EPOCH)
    for name, position, velocity, craft in (
        ("", POSITION, VELOCITY, {}),
        ("x", POSITION[:2], VELOCITY, {}),
        ("x", POSITION * np.nan, VELOCITY, {}),
        ("x", POSITION, VELOCITY * 2, {}),
        ("x", POSITION, VELOCITY, {"cd": 0}),
    ):
        with pytest.raises(CodedError):
            build_state(name, EPOCH, "GCRF", position, velocity, craft)

    again = stored_state("copy", EPOCH, "itrf2014", good.stored())
    assert again.frame == "ITRF2014"  # only a label: the stored state is already GCRS
    np.testing.assert_array_equal(again.position_m, good.position_m)
    with pytest.raises(CodedError):
        stored_state("copy", EPOCH, "GCRF", {"x_m": 1.0})


def test_osculating_summary():
    summary = osculating_summary(POSITION, VELOCITY, "SODA-SAT")
    assert summary["osculating"] is True and summary["category"] == "LEO"
    assert summary["semi_major_axis_km"] == pytest.approx(RADIUS / 1000, rel=1e-12)
    assert summary["eccentricity"] == pytest.approx(0.0, abs=1e-12)
    assert summary["inclination_deg"] == pytest.approx(53.130102, abs=1e-6)
    assert summary["period_min"] == pytest.approx(98.77, abs=0.05)
    assert summary["perigee_alt_km"] == pytest.approx(700.0, abs=1e-6)

    eccentric = osculating_summary(POSITION, VELOCITY * 1.1, "x")
    assert eccentric["eccentricity"] == pytest.approx(0.21, abs=1e-9)
    assert eccentric["perigee_alt_km"] == pytest.approx(700.0, abs=1e-6)
    assert eccentric["apogee_alt_km"] > 4000
    assert osculating_summary(POSITION, VELOCITY, "COSMOS 1 DEB")["category"] == "DEBRIS"
    with pytest.raises(ValueError):
        osculating_summary(POSITION, VELOCITY * 2)
