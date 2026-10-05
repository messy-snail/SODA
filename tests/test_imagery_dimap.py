"""Reading a SPOT scene's METADATA.DIM. The documents are built by ``make_dim`` in conftest."""

import pytest
from conftest import scene_model

from soda.imagery.dimap import MAX_METADATA_BYTES, read_scene
from soda.imagery.formats import ImageryError

# The corners `make_dim` writes: top-left, top-right, bottom-right, bottom-left.
SCENE_QUAD = (126.0, 37.6, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95)


def test_a_scene_is_read(make_dim):
    scene = read_scene(make_dim())
    assert scene.corners == SCENE_QUAD
    assert scene.data_file == "IMAGERY.TIF"
    assert scene.bands == (1,)
    assert scene.name == "SPOT 5 HRG1 A 2006-05-07"
    assert scene.attribution == "© CNES 2006"
    assert scene.acquired_at == "2006-05-07T02:22:12.000Z"
    assert scene.locate is None


def test_a_location_model_that_fits_the_corners_is_kept(make_dim):
    scene = read_scene(make_dim(model=scene_model(64, bow_deg=0.05)))
    assert scene.locate is not None
    # It passes through the corners ...
    assert scene.locate(1, 1) == pytest.approx(SCENE_QUAD[0:2])
    assert scene.locate(64, 64) == pytest.approx(SCENE_QUAD[4:6])
    # ... and bows away from the straight edge between them.
    lon, lat = scene.locate(1, 32.5)
    assert lon == pytest.approx((SCENE_QUAD[0] + SCENE_QUAD[2]) / 2)
    assert lat == pytest.approx((SCENE_QUAD[1] + SCENE_QUAD[3]) / 2 - 0.05)


def test_a_location_model_that_misses_the_corners_is_left_out(make_dim):
    lon_terms, lat_terms = scene_model(64)
    # Row and column terms the other way round: a different convention, not this scene's.
    swapped = [lon_terms[0], lon_terms[2], lon_terms[1], *lon_terms[3:]]
    assert read_scene(make_dim(model=(swapped, lat_terms))).locate is None
    assert read_scene(make_dim(model=(lon_terms[:5], lat_terms))).locate is None
    shifted = [lon_terms[0] + 0.01, *lon_terms[1:]]
    assert read_scene(make_dim(model=(shifted, lat_terms))).locate is None


@pytest.mark.parametrize("order", [(3, 1, 0, 2), (2, 3, 0, 1), (1, 0, 3, 2)])
def test_corners_follow_row_and_column_not_file_order(make_dim, order):
    assert read_scene(make_dim(order=order)).corners == SCENE_QUAD


def test_three_display_bands_make_a_colour_scene(make_dim):
    # SPOT multispectral: near infrared, red and green shown as red, green and blue.
    assert read_scene(make_dim(bands=4, display=(3, 2, 1))).bands == (3, 2, 1)
    assert read_scene(make_dim(bands=4, display=(2, 2, 2))).bands == (2,)


@pytest.mark.parametrize(
    "document",
    [
        lambda make: b"not xml",
        lambda make: b"<Other_Document/>",
        lambda make: make(head="<!DOCTYPE Dimap_Document [<!ENTITY a 'b'>]>"),
        lambda make: make(order=(0, 1, 2)),
        lambda make: make(order=(0, 1, 2, 2)),
        # Top-left and top-right swapped: the corners no longer go round the footprint.
        lambda make: make(quad=(126.8, 37.75, 126.0, 37.6, 126.95, 37.1, 126.15, 36.95)),
        lambda make: make(quad=(126.0, 95.0, 126.8, 37.75, 126.95, 37.1, 126.15, 36.95)),
        lambda make: make(href="../IMAGERY.TIF"),
        lambda make: make(href="/etc/IMAGERY.TIF"),
        lambda make: make(href="SCENE02\\\\IMAGERY.TIF"),
        lambda make: make(href="IMAGERY.JP2"),
        lambda make: make(href=""),
        lambda make: make(bands=1, display=(1, 2, 3)),
        lambda make: make() + b" " * MAX_METADATA_BYTES,
        lambda make: make().replace(b"CNES", b"\xff\xfe"),
    ],
)
def test_what_cannot_place_an_image_is_refused(make_dim, document):
    with pytest.raises(ImageryError) as caught:
        read_scene(document(make_dim))
    assert caught.value.code == "imageryProductInvalid"


def test_a_scene_without_a_source_block_still_has_a_name(make_dim):
    data = make_dim()
    start, end = data.index(b"<Dataset_Sources>"), data.index(b"</Dataset_Sources>")
    scene = read_scene(data[:start] + data[end + len(b"</Dataset_Sources>") :])
    assert scene.name == "SCENE 5 303-275 06/05/07 02:22:12 1 A"
    assert scene.acquired_at is None
