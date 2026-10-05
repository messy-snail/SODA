import numpy as np
import pytest

from soda.orbit.horizon import MAX_MASK_POINTS, HorizonMask
from soda.orbit.propagator import PropagationRequestError


def test_empty_mask_is_none():
    assert HorizonMask.from_points([]) is None
    assert HorizonMask.from_points(None) is None


def test_interpolation_wraps_across_north():
    mask = HorizonMask.from_points([(350, 10), (10, 30)])
    assert mask is not None
    assert mask.elevation_at(0) == pytest.approx(20)
    assert mask.elevation_at(350) == pytest.approx(10)
    assert mask.elevation_at(10) == pytest.approx(30)
    # The long way round stays between the two vertices as well.
    assert 10 <= mask.elevation_at(180) <= 30


def test_points_are_sorted_and_floor_is_the_lowest_vertex():
    mask = HorizonMask.from_points([(200, 25), (10, 5), (100, 40)])
    assert mask is not None
    assert list(mask.az_deg) == [10, 100, 200]
    assert mask.floor_deg == 5
    assert mask.ceiling_deg == 40
    assert mask.as_points() == [(10.0, 5.0), (100.0, 40.0), (200.0, 25.0)]


def test_interpolation_never_dips_below_the_floor():
    mask = HorizonMask.from_points([(0, 5), (90, 40), (180, 12), (270, 33)])
    assert mask is not None
    assert mask.elevation_at(np.arange(0, 360, 0.5)).min() == pytest.approx(mask.floor_deg)


@pytest.mark.parametrize(
    "points",
    [
        [(10, 5)],
        [(10, 5)] * (MAX_MASK_POINTS + 1),
        [(10, 5), (10, 20)],
        [(-1, 5), (10, 20)],
        [(360, 5), (10, 20)],
        [(10, -1), (20, 20)],
        [(10, 90), (20, 20)],
        [(10, float("nan")), (20, 20)],
        [(10, 5, 7), (20, 20, 1)],
    ],
)
def test_rejects_unusable_vertices(points):
    with pytest.raises(PropagationRequestError):
        HorizonMask.from_points(points)
