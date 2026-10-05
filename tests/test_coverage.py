from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from soda.gp.models import normalize_omm
from soda.orbit import coverage
from soda.orbit.access import MAX_ACCESS_WINDOW, Target, find_access
from soda.orbit.access_geometry import Pointing, geometry, state_at
from soda.orbit.coverage import (
    MAX_COVERAGE_CELLS,
    CoverageRequestError,
    cell_centres,
    coverage_events,
)
from soda.orbit.propagator import satellite_from_omm
from soda.orbit.sun import planets

START = datetime(2026, 9, 16, tzinfo=UTC)
END = START + timedelta(days=3)
KOREA = (124.0, 33.0, 131.0, 39.0)
PACIFIC = (175.0, -20.0, -175.0, -10.0)


def roll(max_roll=30.0, sun=10.0):
    return Pointing("roll", max_roll, 0.0, 0.0, sun)


def agile(max_roll=30.0, max_pitch=30.0, sun=10.0):
    return Pointing("roll_pitch", max_roll, max_pitch, 0.0, sun)


@pytest.fixture
def kernel(ephemeris_file):
    return planets(ephemeris_file.parent)


@pytest.fixture
def omm(iss_record):
    return normalize_omm(iss_record, "celestrak").omm


def per_cell(events):
    """Event times of each cell, split out of the concatenated list."""
    return np.split(events.offset_s, np.cumsum(events.counts)[:-1])


def test_cells_run_west_to_east_then_south_to_north():
    centres = cell_centres((120.0, 30.0, 130.0, 40.0), 2, 2)
    assert centres.tolist() == [[32.5, 122.5], [32.5, 127.5], [37.5, 122.5], [37.5, 127.5]]


def test_cells_wrap_across_the_date_line():
    centres = cell_centres(PACIFIC, 2, 1)
    assert centres.tolist() == [[-15.0, 177.5], [-15.0, -177.5]]


@pytest.mark.parametrize("pointing", [roll(30), agile(30, 30)], ids=["roll", "roll_pitch"])
def test_events_are_the_opportunities_of_each_cell_centre(omm, kernel, pointing):
    """The grid search agrees with the per-target search it stands in for."""
    nx, ny = 4, 3
    events = coverage_events(omm, KOREA, nx, ny, START, END, pointing, kernel)
    centres = cell_centres(KOREA, nx, ny)
    targets = [Target.point(str(k), lat, lon) for k, (lat, lon) in enumerate(centres)]
    windows = find_access(omm, targets, START, END, pointing, kernel)
    assert events.counts.tolist() == [len(found) for found in windows]
    assert events.counts.sum() == len(events.offset_s) > 0
    for times, found in zip(per_cell(events), windows, strict=True):
        best = [(window["best_time"] - START).total_seconds() for window in found]
        assert np.abs(times - np.array(best)).max(initial=0.0) <= 2.0


def test_roll_events_stay_within_roll_reach(omm, kernel):
    events = coverage_events(omm, KOREA, 4, 3, START, END, roll(8), kernel)
    wide = coverage_events(omm, KOREA, 4, 3, START, END, roll(30), kernel)
    assert 0 < events.counts.sum() < wide.counts.sum()
    centres = cell_centres(KOREA, 4, 3)
    satellite = satellite_from_omm(omm)
    for centre, times in zip(centres, per_cell(events), strict=True):
        for offset in times:
            geo = geometry(state_at(satellite, kernel, START, np.array([offset])), centre[None])
            # A whole second of rounding moves the look by a fraction of a degree.
            assert abs(geo.roll_deg[0]) <= 8.2 and abs(geo.pitch_deg[0]) < 2.0


def test_darkness_removes_events(omm, kernel):
    lit = coverage_events(omm, KOREA, 4, 3, START, END, roll(30), kernel)
    any_light = coverage_events(omm, KOREA, 4, 3, START, END, roll(30, sun=-90), kernel)
    noon_only = coverage_events(omm, KOREA, 4, 3, START, END, roll(30, sun=89), kernel)
    assert any_light.counts.sum() > lit.counts.sum() > noon_only.counts.sum() == 0


@pytest.mark.parametrize("pointing", [roll(30), agile(30, 30)], ids=["roll", "roll_pitch"])
def test_a_box_across_the_date_line_is_covered_on_both_sides(omm, kernel, pointing):
    events = coverage_events(omm, PACIFIC, 4, 2, START, END, pointing, kernel)
    by_column = events.counts.reshape(2, 4).sum(axis=0)
    assert (by_column > 0).all()
    assert all((np.diff(times) > 0).all() for times in per_cell(events))


@pytest.mark.parametrize("pointing", [roll(30), agile(30, 30)], ids=["roll", "roll_pitch"])
def test_chunking_does_not_change_the_result(omm, kernel, pointing):
    whole = coverage_events(omm, KOREA, 6, 5, START, END, pointing, kernel)
    pieces = coverage_events(omm, KOREA, 6, 5, START, END, pointing, kernel, chunk_pairs=40)
    assert pieces.counts.tolist() == whole.counts.tolist()
    assert pieces.offset_s.tolist() == whole.offset_s.tolist()


def test_limits(omm, kernel, monkeypatch):
    def refused(code, nx=4, ny=3, start=START, end=END):
        with pytest.raises(CoverageRequestError) as caught:
            coverage_events(omm, KOREA, nx, ny, start, end, roll(30), kernel)
        assert caught.value.code == code
        return caught.value

    refused("endBeforeStart", end=START)
    refused("accessWindowTooLong", end=START + MAX_ACCESS_WINDOW + timedelta(seconds=1))
    side = int(MAX_COVERAGE_CELLS**0.5)
    assert refused("coverageGridTooLarge", nx=side + 1, ny=side).params == {
        "max": MAX_COVERAGE_CELLS
    }
    coverage_events(omm, KOREA, side, side, START, START + timedelta(hours=3), roll(30), kernel)

    monkeypatch.setattr(coverage, "MAX_COVERAGE_PAIRS", 100)
    assert refused("coverageTooHeavy").params["max_cells"] == 100
    monkeypatch.undo()
    monkeypatch.setattr(coverage, "MAX_COVERAGE_EVENTS", 3)
    assert refused("coverageTooHeavy").params["max_cells"] >= 100
