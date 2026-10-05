from datetime import UTC, datetime

import pytest

from soda.gp.classify import classify
from soda.gp.models import InvalidOmm, normalize_omm


def test_normalizes_celestrak_numbers(iss_record):
    element = normalize_omm(iss_record, "celestrak")
    assert element.norad_id == 25544
    assert element.name == "ISS (ZARYA)"
    assert element.epoch == datetime(2026, 9, 15, 21, 14, 23, 428032, tzinfo=UTC)
    assert element.omm["EPOCH"] == "2026-09-15T21:14:23.428032"
    assert element.omm["MEAN_MOTION"] == pytest.approx(15.49128922)


def test_normalizes_space_track_strings(iss_record):
    record = {key: str(value) for key, value in iss_record.items()}
    record.update(EPOCH="2026-09-15T21:14:23", DECAY_DATE=None, RCS_SIZE="LARGE")
    element = normalize_omm(record, "space-track")
    assert element.omm["NORAD_CAT_ID"] == 25544
    assert element.omm["INCLINATION"] == pytest.approx(51.631)
    assert element.omm["EPOCH"] == "2026-09-15T21:14:23.000000"
    assert "RCS_SIZE" not in element.omm


@pytest.mark.parametrize("field", ["MEAN_MOTION", "EPOCH", "NORAD_CAT_ID"])
def test_rejects_missing_required_fields(iss_record, field):
    del iss_record[field]
    with pytest.raises(InvalidOmm):
        normalize_omm(iss_record, "celestrak")


@pytest.mark.parametrize(
    ("name", "mean_motion", "eccentricity", "expected"),
    [
        ("ISS (ZARYA)", 15.5, 0.0005, "LEO"),
        ("GPS BIIF-1", 2.0, 0.01, "MEO"),
        ("GOES 19", 1.0027, 0.0001, "GEO"),
        ("MOLNIYA 1-91", 2.006, 0.7, "HEO"),
        ("COSMOS 2251 DEB", 14.3, 0.002, "DEBRIS"),
        ("CZ-4C R/B", 14.1, 0.01, "DEBRIS"),
    ],
)
def test_classify(name, mean_motion, eccentricity, expected):
    omm = {"OBJECT_NAME": name, "MEAN_MOTION": mean_motion, "ECCENTRICITY": eccentricity}
    assert classify(omm) == expected
