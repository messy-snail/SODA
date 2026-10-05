"""Power budget: array incidence and the battery energy balance, against closed forms."""

from datetime import UTC, datetime

import numpy as np
import pytest

from soda.orbit.access_geometry import surface_ecef
from soda.orbit.eclipse import SHADOW_RADIUS_M
from soda.orbit.power import (
    MAX_POWER_INTERVALS,
    Contact,
    PowerRequestError,
    PowerSpec,
    Shot,
    Sun,
    build_timeline,
    simulate_power,
)
from soda.orbit.power_geometry import geodetic_up, station_ecef
from soda.orbit.propagator import Ephemeris
from soda.orbit.swath import geodetic_normals

RADIUS_M = SHADOW_RADIUS_M + 500_000
PERIOD_S = 5670.0
STEP_S = 30.0
RATE = 2 * np.pi / PERIOD_S
#: Half-angle of the shadow seen from the geocenter at this radius.
HALF_ANGLE = np.arcsin(SHADOW_RADIUS_M / RADIUS_M)
ECLIPSE_S = 2 * HALF_ANGLE / RATE


def circular(turns: float = 1.0) -> Ephemeris:
    """An equatorial circular orbit over a non-rotating Earth, starting on the +x axis."""
    count = int(round(turns * PERIOD_S / STEP_S)) + 1
    angle = RATE * np.arange(count) * STEP_S
    zeros = np.zeros(count)
    position = RADIUS_M * np.column_stack([np.cos(angle), np.sin(angle), zeros])
    velocity = RADIUS_M * RATE * np.column_stack([-np.sin(angle), np.cos(angle), zeros])
    return Ephemeris(
        start=datetime(2026, 9, 16, tzinfo=UTC),
        step_s=STEP_S,
        times=None,
        fixed_m=position,
        fixed_velocity_m_s=velocity,
        inertial_m=position,
        lat_deg=zeros,
        lon_deg=np.degrees(angle),
        alt_km=zeros,
        valid=np.ones(count, dtype=bool),
        warnings=[],
    )


def fixed_sun(beta_deg: float = 0.0) -> Sun:
    """The Sun on the +x axis, lifted ``beta_deg`` off the orbit plane, at 1 AU."""
    beta = np.radians(beta_deg)
    direction = np.array([np.cos(beta), 0.0, np.sin(beta)])
    return Sun(
        unit_itrs=lambda offsets: np.tile(direction, (len(offsets), 1)),
        distance_au=lambda offsets: np.ones(len(offsets)),
    )


def cos_at(timeline, spec, offset_s: float) -> float:
    """Incidence cosine of the segment that contains ``offset_s``."""
    index = np.searchsorted(timeline.edges_s, offset_s, side="right") - 1
    return timeline.generation_w[index] / spec.array_w


def test_geodetic_up_matches_the_normal_a_position_was_built_from():
    points = np.array([[0.0, 0.0], [36.35, 127.38], [-72.0, -45.0], [89.0, 10.0]])
    normals = geodetic_normals(points[:, 0], points[:, 1])
    position = surface_ecef(points) + 600_000 * normals
    assert np.allclose(geodetic_up(position), normals, atol=1e-9)
    assert np.allclose(station_ecef(36.35, 127.38, 600_000), position[1])


def test_sun_pointing_with_no_load_keeps_the_battery_full():
    spec = PowerSpec(array_w=100, capacity_wh=50, charge_efficiency=0.8)
    result = simulate_power(circular(), fixed_sun(beta_deg=80), spec, [], [])
    assert result.eclipse_s == []
    assert result.generated_wh == pytest.approx(100 * PERIOD_S / 3600)
    assert result.shunted_wh == pytest.approx(result.generated_wh)
    assert result.min_soc == result.final_soc == 1.0
    assert result.time_s.tolist() == [0.0, PERIOD_S]


def test_eclipse_discharges_by_the_load_over_the_discharge_efficiency():
    spec = PowerSpec(
        array_w=1000, capacity_wh=100, base_w=60, discharge_efficiency=0.8, dod_limit=0.05
    )
    result = simulate_power(circular(), fixed_sun(), spec, [], [])
    enter, leave = result.eclipse_s
    assert leave - enter == pytest.approx(ECLIPSE_S, abs=2)
    drawn = 60 * (leave - enter) / 3600 / 0.8
    assert result.min_soc == pytest.approx(1 - drawn / 100, abs=1e-9)
    assert result.final_soc == 1.0
    assert result.unmet_wh == 0 and result.empty_s == []
    # The limit is crossed 5 Wh into the eclipse and again once that much is charged back.
    crossed, recovered = result.below_limit_s
    assert crossed == pytest.approx(enter + 5 / (60 / 0.8) * 3600, abs=1e-6)
    assert recovered == pytest.approx(leave + (drawn - 5) / (940 * 0.9) * 3600, abs=1e-6)


def test_charging_counts_the_charge_efficiency():
    spec = PowerSpec(array_w=100, capacity_wh=1000, initial_soc=0.5, charge_efficiency=0.7)
    result = simulate_power(circular(), fixed_sun(beta_deg=80), spec, [], [])
    assert result.final_soc == pytest.approx(0.5 + 100 * 0.7 * PERIOD_S / 3600 / 1000)
    assert result.shunted_wh == 0


def test_an_empty_battery_leaves_load_unserved():
    spec = PowerSpec(
        array_w=1e-9, capacity_wh=10, base_w=36, discharge_efficiency=0.5, initial_soc=0.5
    )
    result = simulate_power(circular(), fixed_sun(beta_deg=80), spec, [], [])
    # 5 Wh stored is 2.5 Wh at the bus: 250 s of a 36 W load.
    assert result.empty_s == pytest.approx([250.0, PERIOD_S])
    assert result.consumed_wh == pytest.approx(2.5, abs=1e-6)
    assert result.unmet_wh == pytest.approx(36 * PERIOD_S / 3600 - 2.5, abs=1e-6)
    assert result.min_soc == result.final_soc == 0.0
    assert result.below_limit_s[-1] == PERIOD_S


def test_nadir_contact_sees_the_sun_at_its_elevation():
    spec = PowerSpec(array_w=100, capacity_wh=50, contact_attitude="nadir")
    contact = Contact(300.0, 900.0)
    timeline = build_timeline(circular(), fixed_sun(), spec, [], [contact])
    for offset in (302.5, 602.5, 897.5):
        assert cos_at(timeline, spec, offset) == pytest.approx(np.cos(RATE * offset), abs=1e-6)
    assert cos_at(timeline, spec, 200.0) == cos_at(timeline, spec, 1000.0) == 1.0
    assert timeline.off_sun_s == pytest.approx(600.0)


def test_sun_attitude_contact_only_adds_its_load():
    spec = PowerSpec(array_w=100, capacity_wh=50, base_w=10, downlink_w=40, contact_w=5)
    contacts = [Contact(300.0, 900.0), Contact(1000.0, 1200.0, downlink=False)]
    timeline = build_timeline(circular(), fixed_sun(), spec, [], contacts)
    assert timeline.off_sun_s == 0
    assert cos_at(timeline, spec, 600.0) == 1.0
    loads = dict(zip(timeline.edges_s[:-1].tolist(), timeline.load_w.tolist(), strict=True))
    assert loads[300.0] == 50 and loads[1000.0] == 15 and loads[0.0] == 10


@pytest.mark.parametrize(
    ("roll_deg", "pitch_deg"), [(0.0, 0.0), (30.0, 0.0), (-20.0, 0.0), (0.0, 25.0), (0.0, -25.0)]
)
def test_imaging_tilt_changes_the_incidence(roll_deg, pitch_deg):
    spec = PowerSpec(array_w=100, capacity_wh=50, imaging_w=80)
    shot = Shot(400.0, 420.0, roll_deg, pitch_deg)
    timeline = build_timeline(circular(), fixed_sun(), spec, [shot], [])
    angle = RATE * 402.5
    # Roll turns about the track, out of the orbit plane; pitch turns within it, ahead.
    expected = np.cos(angle - np.radians(pitch_deg)) * np.cos(np.radians(roll_deg))
    assert cos_at(timeline, spec, 402.5) == pytest.approx(expected, abs=1e-6)
    assert timeline.load_w[np.searchsorted(timeline.edges_s, 400.0)] == 80


def test_slew_holds_the_imaging_attitude_but_not_its_load():
    spec = PowerSpec(array_w=100, capacity_wh=50, imaging_w=80, slew_s=60)
    timeline = build_timeline(circular(), fixed_sun(), spec, [Shot(400.0, 420.0, 30.0, 0.0)], [])
    assert timeline.off_sun_s == pytest.approx(140.0)
    assert cos_at(timeline, spec, 350.0) < 1.0
    assert timeline.load_w[np.searchsorted(timeline.edges_s, 350.0, side="right") - 1] == 0
    assert cos_at(timeline, spec, 300.0) == 1.0


def test_station_tracking_points_the_body_at_the_station():
    spec = PowerSpec(array_w=100, capacity_wh=50, contact_attitude="station")
    station = np.array([SHADOW_RADIUS_M, 0.0, 0.0])
    contact = Contact(0.0, 300.0, station_m=station)
    timeline = build_timeline(circular(), fixed_sun(), spec, [], [contact])
    # 2.5 s past the station the look is already a couple of degrees off the vertical.
    assert cos_at(timeline, spec, 2.5) == pytest.approx(1.0, abs=1e-3)
    angle = RATE * 297.5
    look = station - RADIUS_M * np.array([np.cos(angle), np.sin(angle), 0.0])
    assert cos_at(timeline, spec, 297.5) == pytest.approx(-look[0] / np.linalg.norm(look), abs=1e-6)
    # Following the station tilts the array further from the Sun than looking straight down.
    assert cos_at(timeline, spec, 297.5) < np.cos(angle)


def test_generation_follows_the_sun_distance_and_stops_in_eclipse():
    far = Sun(fixed_sun().unit_itrs, lambda offsets: np.full(len(offsets), 1.1))
    spec = PowerSpec(array_w=121, capacity_wh=50)
    timeline = build_timeline(circular(), far, spec, [], [])
    assert timeline.generation_w[0] == pytest.approx(100)
    enter, leave = timeline.eclipse_s
    dark = (timeline.edges_s[:-1] >= enter) & (timeline.edges_s[1:] <= leave)
    assert dark.any() and not timeline.generation_w[dark].any()


def test_the_starting_soc_applies_at_the_chosen_time():
    spec = PowerSpec(array_w=1000, capacity_wh=100, base_w=60, initial_soc=0.5, slew_s=60)
    whole = simulate_power(circular(), fixed_sun(), spec, [], [])
    enter, leave = whole.eclipse_s
    # Starting halfway through the eclipse leaves only its second half to discharge in.
    middle = (enter + leave) / 2
    shots = [Shot(100.0, 120.0, 30.0, 0.0), Shot(middle - 10, middle + 10, 0.0, 0.0)]
    late = simulate_power(circular(), fixed_sun(), spec, shots, [], begin_s=middle)
    assert late.time_s[0] == middle and late.soc[0] == 0.5
    assert late.min_soc == pytest.approx(0.5 - 60 * (leave - middle) / 3600 / 0.9 / 100)
    assert late.eclipse_s == whole.eclipse_s
    assert late.time_s[-1] == PERIOD_S and late.off_sun_s == 0
    for outside in (-1.0, PERIOD_S, PERIOD_S + 1):
        with pytest.raises(PowerRequestError) as error:
            simulate_power(circular(), fixed_sun(), spec, [], [], begin_s=outside)
        assert error.value.code == "powerStartOutsideRun"


def test_too_many_intervals_are_rejected():
    spec = PowerSpec(array_w=100, capacity_wh=50)
    shots = [Shot(0.0, 1.0, 0.0, 0.0)] * (MAX_POWER_INTERVALS + 1)
    with pytest.raises(PowerRequestError) as error:
        simulate_power(circular(), fixed_sun(), spec, shots, [])
    assert error.value.code == "powerIntervalsTooMany"
