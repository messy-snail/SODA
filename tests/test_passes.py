from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from skyfield.api import wgs84
from skyfield.framelib import itrs

from soda.gp.models import normalize_omm
from soda.orbit.horizon import HorizonMask
from soda.orbit.passes import (
    MAX_STATIONS,
    TRACK_STEP_S,
    Observer,
    find_passes,
    find_passes_multi,
)
from soda.orbit.propagator import PropagationRequestError, satellite_from_omm, timescale
from soda.orbit.sun import planets

DAEJEON = Observer(36.3504, 127.3845, 70, 10)
START = datetime(2026, 9, 16, tzinfo=UTC)


@pytest.fixture
def kernel(ephemeris_file):
    return planets(ephemeris_file.parent)


def elevation(omm, when):
    topos = wgs84.latlon(DAEJEON.lat_deg, DAEJEON.lon_deg, elevation_m=DAEJEON.alt_m)
    t = timescale().from_datetime(when)
    return (satellite_from_omm(omm) - topos).at(t).altaz()[0].degrees


def test_passes_cross_minimum_elevation(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    passes = find_passes(omm, DAEJEON, START, START + timedelta(days=2), kernel)
    assert len(passes) >= 6
    for item in passes:
        assert item["aos"] < item["tca"] < item["los"]
        assert item["max_elevation_deg"] >= 10
        assert elevation(omm, item["aos"]) == pytest.approx(10, abs=0.05)
        assert elevation(omm, item["los"]) == pytest.approx(10, abs=0.05)
        assert elevation(omm, item["tca"]) == pytest.approx(item["max_elevation_deg"], abs=1e-6)
        # ISS near 420 km: straight overhead at the least, a few thousand km near 10 deg.
        assert 400 < item["tca_range_km"] < 2600
        assert item["visible"] == (item["satellite_sunlit"] and item["observer_sun_alt_deg"] < -6)
        assert not item["partial"]


def test_pass_track_runs_from_aos_to_los(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    item = find_passes(omm, DAEJEON, START, START + timedelta(days=1), kernel)[0]
    track = np.asarray(item["track_fixed_m"]).reshape(-1, 3)
    assert len(track) == int(np.ceil(item["duration_s"] / TRACK_STEP_S)) + 1
    ts = timescale()
    satellite = satellite_from_omm(omm)
    for when, point in ((item["aos"], track[0]), (item["los"], track[-1])):
        expected = satellite.at(ts.from_datetime(when)).frame_xyz(itrs).m
        assert np.linalg.norm(point - expected) < 1.0
    radius_km = np.linalg.norm(track, axis=1) / 1000
    assert ((radius_km > 6600) & (radius_km < 7000)).all()


def test_pass_in_progress_keeps_its_real_aos(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    first = find_passes(omm, DAEJEON, START, START + timedelta(days=1), kernel)[0]
    midway = first["aos"] + (first["los"] - first["aos"]) / 2
    found = find_passes(omm, DAEJEON, midway, first["los"] + timedelta(minutes=1), kernel)
    assert len(found) == 1
    item = found[0]
    assert item["partial"]
    assert not item["clipped_start"] and not item["clipped_end"]
    assert item["aos"] < midway
    assert item["aos"] == pytest.approx(first["aos"], abs=timedelta(seconds=1))
    assert elevation(omm, item["aos"]) == pytest.approx(10, abs=0.05)
    assert item["pass_index"] == 0


def test_pass_running_past_the_end_keeps_its_real_los(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    first = find_passes(omm, DAEJEON, START, START + timedelta(days=1), kernel)[0]
    midway = first["aos"] + (first["los"] - first["aos"]) / 2
    found = find_passes(omm, DAEJEON, first["aos"] - timedelta(minutes=1), midway, kernel)
    assert len(found) == 1
    assert found[0]["partial"]
    assert found[0]["los"] > midway
    assert elevation(omm, found[0]["los"]) == pytest.approx(10, abs=0.05)


def test_contacts_outside_the_window_are_dropped(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    first, second = find_passes(omm, DAEJEON, START, START + timedelta(days=1), kernel)[:2]
    # Just after the first LOS: the look-around margin reaches it, but it is not in the window.
    gap_start = first["los"] + timedelta(minutes=1)
    found = find_passes(omm, DAEJEON, gap_start, second["los"], kernel)
    assert [item["aos"] for item in found] == [
        pytest.approx(second["aos"], abs=timedelta(seconds=1))
    ]


def test_window_limits(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    with pytest.raises(PropagationRequestError):
        find_passes(omm, DAEJEON, START, START + timedelta(days=31), kernel)


def required_deg(mask, az_deg, min_elev_deg):
    return max(min_elev_deg, float(mask.elevation_at(az_deg)))


def masked(mask_points, min_elev_deg=10):
    return Observer(
        DAEJEON.lat_deg,
        DAEJEON.lon_deg,
        DAEJEON.alt_m,
        min_elev_deg,
        HorizonMask.from_points(mask_points),
    )


def test_uniform_mask_matches_no_mask(iss_record, kernel):
    """A mask that asks for the requested minimum everywhere must change nothing."""
    omm = normalize_omm(iss_record, "celestrak").omm
    window = (START, START + timedelta(days=2))
    plain = find_passes(omm, DAEJEON, *window, kernel)
    uniform = find_passes(omm, masked([(0, 10), (180, 10)]), *window, kernel)
    assert len(uniform) == len(plain)
    for a, b in zip(plain, uniform, strict=True):
        # Bisecting the mask is finer than find_events, so allow a fraction of a second.
        assert b["aos"] == pytest.approx(a["aos"], abs=timedelta(seconds=1))
        assert b["los"] == pytest.approx(a["los"], abs=timedelta(seconds=1))
        assert b["max_elevation_deg"] == pytest.approx(a["max_elevation_deg"], abs=0.01)
        assert not b["mask_limited"]


def test_mask_sets_the_elevation_at_every_boundary(iss_record, kernel):
    """AOS and LOS sit exactly where the mask requires at their own azimuth."""
    omm = normalize_omm(iss_record, "celestrak").omm
    points = [(0, 10), (170, 10), (200, 30), (250, 30), (280, 10), (359, 10)]
    observer = masked(points)
    passes = find_passes(omm, observer, START, START + timedelta(days=2), kernel)
    assert passes
    assert any(item["mask_limited"] for item in passes)
    for item in passes:
        assert not item["partial"]
        for edge in ("aos", "los"):
            azimuth = item[f"{edge}_azimuth_deg"]
            assert elevation(omm, item[edge]) == pytest.approx(
                required_deg(observer.mask, azimuth, 10), abs=0.05
            )


def test_mask_splits_a_pass_into_contacts(iss_record, kernel):
    """A notch across the culmination breaks one window into two separate contacts."""
    omm = normalize_omm(iss_record, "celestrak").omm
    points = [(0, 10), (300, 10), (310, 75), (330, 75), (340, 10), (359, 10)]
    observer = masked(points)
    passes = find_passes(omm, observer, START, START + timedelta(hours=9), kernel)
    pieces = [item for item in passes if item["pass_index"] == 0]
    assert len(pieces) == 2
    assert all(item["mask_limited"] for item in pieces)
    assert pieces[0]["los"] < pieces[1]["aos"]
    blocked = pieces[0]["los"] + (pieces[1]["aos"] - pieces[0]["los"]) / 2
    azimuth = (
        (
            satellite_from_omm(omm)
            - wgs84.latlon(DAEJEON.lat_deg, DAEJEON.lon_deg, elevation_m=DAEJEON.alt_m)
        )
        .at(timescale().from_datetime(blocked))
        .altaz()[1]
        .degrees
    )
    assert elevation(omm, blocked) < required_deg(observer.mask, azimuth, 10)


def test_requested_minimum_wins_over_a_lower_mask(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    observer = masked([(0, 5), (180, 5)], min_elev_deg=20)
    passes = find_passes(omm, observer, START, START + timedelta(days=2), kernel)
    assert passes
    for item in passes:
        assert item["max_elevation_deg"] >= 20
        assert elevation(omm, item["aos"]) == pytest.approx(20, abs=0.05)
        assert not item["mask_limited"]


def test_station_count_limit(iss_record, kernel):
    omm = normalize_omm(iss_record, "celestrak").omm
    window = (START, START + timedelta(hours=6))
    both = find_passes_multi(omm, [DAEJEON, Observer(37.5, 127.0, 0)], *window, kernel)
    assert len(both) == 2
    assert both[0] == find_passes(omm, DAEJEON, *window, kernel)
    with pytest.raises(PropagationRequestError):
        find_passes_multi(omm, [DAEJEON] * (MAX_STATIONS + 1), *window, kernel)
    with pytest.raises(PropagationRequestError):
        find_passes_multi(omm, [], *window, kernel)
