from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from soda.gp.models import normalize_omm
from soda.orbit.access import (
    MAX_ACCESS_WINDOW,
    MAX_TARGETS,
    AccessRequestError,
    Target,
    access_report,
    find_access,
)
from soda.orbit.access_geometry import Pointing, geometry, state_at
from soda.orbit.propagator import propagate, satellite_from_omm
from soda.orbit.sun import planets, sun_unit_itrs
from soda.orbit.swath import edge_points, geodetic_normals, surface_lonlat

START = datetime(2026, 9, 16, tzinfo=UTC)


def roll(max_roll=30.0, fov=0.0, sun=10.0):
    return Pointing("roll", max_roll, 0.0, fov, sun)


def agile(max_roll=30.0, max_pitch=30.0, sun=10.0):
    return Pointing("roll_pitch", max_roll, max_pitch, 0.0, sun)


@pytest.fixture
def kernel(ephemeris_file):
    return planets(ephemeris_file.parent)


@pytest.fixture
def omm(iss_record):
    return normalize_omm(iss_record, "celestrak").omm


def sample(omm, kernel, *, daylight: bool):
    """An ephemeris sample over mid latitudes with the Sun high above, or well below."""
    ephemeris = propagate(omm, START, START + timedelta(hours=6), 30)
    up = geodetic_normals(ephemeris.lat_deg, ephemeris.lon_deg)
    sun_elev = np.degrees(np.arcsin((up * sun_unit_itrs(kernel, ephemeris.times)).sum(axis=1)))
    wanted = sun_elev > 40 if daylight else sun_elev < -30
    index = int(np.flatnonzero(wanted & (np.abs(ephemeris.lat_deg) < 40))[5])
    return ephemeris, index


def at(ephemeris, index):
    return START + timedelta(seconds=float(ephemeris.step_s * index))


def around(when, minutes=5):
    return when - timedelta(minutes=minutes), when + timedelta(minutes=minutes)


def edge_target(ephemeris, i, angle_deg, side):
    """The ground point a ``side * angle_deg`` roll looks at from sample ``i``."""
    rows = slice(i, i + 1)
    left, right = edge_points(
        ephemeris.fixed_m[rows],
        ephemeris.fixed_velocity_m_s[rows],
        ephemeris.lat_deg[rows],
        ephemeris.lon_deg[rows],
        angle_deg,
    )
    lon, lat = surface_lonlat(right if side > 0 else left)[0]
    return Target.point("edge", lat, lon)


def pointing_at(omm, kernel, when, target):
    state = state_at(satellite_from_omm(omm), kernel, when, np.array([0.0]))
    return geometry(state, target.center)


def test_roll_only_point_is_an_instant_with_no_pitch(omm, kernel):
    ephemeris, i = sample(omm, kernel, daylight=True)
    when = at(ephemeris, i)
    target = Target.point("nadir", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]))
    (windows,) = find_access(omm, [target], *around(when), roll(10), kernel)
    assert len(windows) == 1
    window = windows[0]
    assert window["start"] == window["best_time"] == window["end"]
    assert window["duration_s"] == 0
    assert abs(window["roll_deg"]) < 0.1 and abs(window["pitch_deg"]) < 0.05
    assert abs((window["best_time"] - when).total_seconds()) < 1.0
    assert window["coverage"] == 1.0
    assert window["target_sun_elev_deg"] > 40
    assert abs(pointing_at(omm, kernel, window["best_time"], target).pitch_deg[0]) < 0.05


@pytest.mark.parametrize("pointing", [roll(30), agile(30, 30)], ids=["roll", "roll_pitch"])
@pytest.mark.parametrize("side", [-1, 1])
def test_roll_matches_swath_edge_geometry(omm, kernel, side, pointing):
    """A target on the 20 degree swath edge needs a 20 degree roll toward that side."""
    ephemeris, i = sample(omm, kernel, daylight=True)
    target = edge_target(ephemeris, i, 20, side)
    (windows,) = find_access(omm, [target], *around(at(ephemeris, i)), pointing, kernel)
    assert len(windows) == 1
    assert windows[0]["roll_deg"] == pytest.approx(20 * side, abs=0.3)
    assert abs(windows[0]["pitch_deg"]) < 0.1


def test_half_the_field_of_view_widens_the_roll_reach(omm, kernel):
    """A 20 degree target is out of a 15 degree roll, but in once a 12 degree FOV is added."""
    ephemeris, i = sample(omm, kernel, daylight=True)
    target = edge_target(ephemeris, i, 20, 1)
    span = around(at(ephemeris, i))
    assert find_access(omm, [target], *span, roll(15, fov=0), kernel) == [[]]
    assert len(find_access(omm, [target], *span, roll(15, fov=12), kernel)[0]) == 1


def test_roll_pitch_window_edges_sit_on_the_pitch_limit(omm, kernel):
    ephemeris, i = sample(omm, kernel, daylight=True)
    target = Target.point("t", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]) + 1.0)
    (windows,) = find_access(omm, [target], *around(at(ephemeris, i), 10), agile(30, 25), kernel)
    window = windows[0]
    for edge in (window["start"], window["end"]):
        assert abs(pointing_at(omm, kernel, edge, target).pitch_deg[0]) == pytest.approx(
            25, abs=0.3
        )
    assert abs(pointing_at(omm, kernel, window["best_time"], target).pitch_deg[0]) < 0.1


def test_more_pitch_means_a_longer_window(omm, kernel):
    ephemeris, i = sample(omm, kernel, daylight=True)
    target = Target.point("t", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]))
    span = around(at(ephemeris, i), 10)
    (narrow,) = find_access(omm, [target], *span, agile(30, 10), kernel)
    (wide,) = find_access(omm, [target], *span, agile(30, 30), kernel)
    assert wide[0]["duration_s"] > 2 * narrow[0]["duration_s"] > 0


def test_night_targets_are_dropped(omm, kernel):
    ephemeris, i = sample(omm, kernel, daylight=False)
    target = Target.point("night", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]))
    span = around(at(ephemeris, i))
    assert find_access(omm, [target], *span, roll(10), kernel) == [[]]
    assert len(find_access(omm, [target], *span, roll(10, sun=-90), kernel)[0]) == 1


def test_diagnosis_tells_a_dark_pass_from_one_out_of_reach(omm, kernel):
    ephemeris, i = sample(omm, kernel, daylight=False)
    target = Target.point("night", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]))
    span = around(at(ephemeris, i))
    (dark,) = access_report(omm, [target], *span, roll(10), kernel).diagnosis
    assert dark["passes"] == dark["dark"] == 1
    assert dark["best_sun_elev_deg"] < -30
    assert dark["nearest_roll_deg"] < 1
    (lit,) = access_report(omm, [target], *span, roll(10, sun=-90), kernel).diagnosis
    assert lit == {**dark, "dark": 0, "best_sun_elev_deg": None}

    # 20 degrees off to the side: a 10 degree roll does not get there, whatever the light.
    side = edge_target(ephemeris, i, 20.0, +1)
    report = access_report(omm, [side], *span, roll(10, sun=-90), kernel)
    assert report.windows == [[]]
    (far,) = report.diagnosis
    assert far["passes"] == 0 and far["dark"] == 0
    assert far["nearest_roll_deg"] == pytest.approx(20, abs=0.5)

    # Nothing passes within an empty stretch of time.
    hour = timedelta(hours=1)
    quiet = access_report(
        omm, [Target.point("pole", 89.9, 0.0)], START, START + hour, roll(), kernel
    )
    assert quiet.diagnosis[0]["passes"] == 0


def test_box_across_the_date_line_aims_at_its_nearest_point():
    box = Target.box("pacific", 175, -20, -175, -10)
    assert abs(box.lon_deg) == pytest.approx(180)
    sub_lat = np.array([-15.0, 0.0, -30.0, -15.0, -15.0])
    aim = box.aim_deg(sub_lat, np.array([179.0, -170.0, 170.0, 5.0, -5.0]))
    np.testing.assert_allclose(aim[:, 0], [-15, -10, -20, -15, -15])
    np.testing.assert_allclose(aim[:, 1], [179, -175, 175, 175, -175])
    grid = box.grid_deg()
    assert len(grid) == 25
    assert ((grid[:, 1] >= 175) | (grid[:, 1] <= -175)).all()


@pytest.mark.parametrize("pointing", [roll(30), agile(30, 30)], ids=["roll", "roll_pitch"])
def test_box_windows_stay_whole_across_the_date_line(omm, kernel, pointing):
    box = Target.box("pacific", 175, -20, -175, -10)
    (windows,) = find_access(omm, [box], START, START + timedelta(days=3), pointing, kernel)
    assert windows
    starts = [w["start"] for w in windows]
    gaps = [(b - a["end"]).total_seconds() for a, b in zip(windows, starts[1:], strict=False)]
    assert all(gap > 600 for gap in gaps)
    assert all(0 <= w["coverage"] <= 1 for w in windows)
    assert max(w["coverage"] for w in windows) > 0
    # A box is aimed at the part it can see, so the pointing stays inside the limits.
    assert all(abs(w["roll_deg"]) <= 30.01 for w in windows)
    assert all(abs(w["pitch_deg"]) <= 30.01 for w in windows)


def test_roll_only_box_window_is_the_sweep_over_it(omm, kernel):
    """The strip takes about box length / ground speed to cross the box."""
    box = Target.box("pacific", 175, -20, -175, -10)
    (windows,) = find_access(omm, [box], START, START + timedelta(days=3), roll(30), kernel)
    # The strip (about 500 km at 30 degrees from 420 km) covers part of a 1100 km box.
    full = [w for w in windows if w["coverage"] >= 0.3]
    assert full
    # 10 degrees of latitude is about 1110 km; at ~7 km/s on a 52 degree inclined track the
    # crossing takes two to five minutes.
    assert all(60 < w["duration_s"] < 360 for w in full)
    assert all(w["start"] <= w["best_time"] <= w["end"] for w in windows)


def test_limits(omm, kernel):
    target = Target.point("t", 0, 0)
    too_long = START + MAX_ACCESS_WINDOW + timedelta(seconds=1)
    cases = [
        ([target], START, too_long, "accessWindowTooLong"),
        ([], START, START + timedelta(hours=1), "noTargetSelected"),
        ([target] * (MAX_TARGETS + 1), START, START + timedelta(hours=1), "tooManyTargets"),
        ([target], START, START, "endBeforeStart"),
    ]
    for targets, start, end, code in cases:
        with pytest.raises(AccessRequestError) as caught:
            find_access(omm, targets, start, end, roll(30), kernel)
        assert caught.value.code == code


def test_strip_is_centred_on_the_target_and_as_wide_as_the_fov(omm, kernel):
    """Nadir target, 10 degree FOV: the strip runs over the target, about 2h tan 5 wide."""
    ephemeris, i = sample(omm, kernel, daylight=True)
    target = Target.point("nadir", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]))
    pointing = roll(10, fov=10)
    (windows,) = find_access(omm, [target], *around(at(ephemeris, i)), pointing, kernel, 10)
    window = windows[0]
    assert (window["shot_end"] - window["shot_start"]).total_seconds() == pytest.approx(10)
    left, right = window["strip_left"], window["strip_right"]
    assert len(left) == len(right) == len(window["track_fixed_m"]) == 11
    middle = (left[5] + right[5]) / 2
    assert middle[1] == pytest.approx(target.lat_deg, abs=0.05)
    assert middle[0] == pytest.approx(target.lon_deg, abs=0.05)
    width_km = np.linalg.norm(surface_lonlat_km(left[5]) - surface_lonlat_km(right[5]))
    altitude_km = float(ephemeris.alt_km[i])
    assert width_km == pytest.approx(2 * altitude_km * np.tan(np.radians(5)), rel=0.03)


def test_shot_length_sets_the_strip_length(omm, kernel):
    ephemeris, i = sample(omm, kernel, daylight=True)
    target = Target.point("nadir", float(ephemeris.lat_deg[i]), float(ephemeris.lon_deg[i]))
    span = around(at(ephemeris, i))
    (short,) = find_access(omm, [target], *span, roll(10), kernel, 4)
    (long,) = find_access(omm, [target], *span, roll(10), kernel, 40)
    assert len(long[0]["strip_left"]) > 5 * len(short[0]["strip_left"]) // 2
    assert (long[0]["shot_end"] - long[0]["shot_start"]).total_seconds() == pytest.approx(40)


def surface_lonlat_km(lonlat):
    """Earth-fixed km of a ``(lon, lat)`` surface point."""
    from soda.orbit.access_geometry import surface_ecef

    return surface_ecef(np.array([[lonlat[1], lonlat[0]]]))[0] / 1000
