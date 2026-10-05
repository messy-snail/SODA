import struct
from pathlib import Path

import pytest

from soda.logos import MAX_LOGO_PX, LogoError, LogoStore, validate_png


def test_validate_png_accepts_images(make_png):
    validate_png(make_png())
    validate_png(make_png(MAX_LOGO_PX, 1))


def _with_size(png: bytes, width: int, height: int) -> bytes:
    return png[:16] + struct.pack(">II", width, height) + png[24:]


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda png: png[:20], "logoNotPng"),
        (lambda png: b"GIF89a" + png[6:], "logoNotPng"),
        (lambda png: png[:12] + b"IDAT" + png[16:], "logoHeaderUnreadable"),
        (lambda png: png[:8] + struct.pack(">I", 12) + png[12:], "logoHeaderUnreadable"),
        (lambda png: _with_size(png, 0, 1), "logoTooWide"),
        (lambda png: _with_size(png, 1, MAX_LOGO_PX + 1), "logoTooWide"),
    ],
)
def test_validate_png_rejects_broken_files(make_png, mutate, code):
    with pytest.raises(LogoError) as caught:
        validate_png(mutate(make_png()))
    assert caught.value.code == code


def test_store_round_trip(tmp_path, make_png):
    store = LogoStore(tmp_path / "logos")
    assert store.entries() == [] and store.get("default") is None
    png = make_png()
    store.save("40536", png)
    store.save("default", png)
    store.save("starlink", png)
    (tmp_path / "logos" / "Telepix.png").write_bytes(png)
    # The default first, then operators by name, then NORAD numbers. An uppercase name is
    # not a valid operator slug, so it stays invisible.
    assert [logo.name for logo in store.entries()] == ["default", "starlink", "40536"]
    logo = store.get("40536")
    assert logo.norad_id == 40536 and logo.operator is None and logo.size_bytes == len(png)
    assert store.get("starlink").operator == "starlink"
    assert store.get("default").operator is None
    assert store.path("default").suffix == ".png"
    assert not list((tmp_path / "logos").glob("*.tmp"))

    with pytest.raises(LogoError):
        store.save("40536", b"not an image")
    assert store.path("40536").read_bytes() == png
    for bad in ("../default", "Telepix", "007", "x", "a" * 33):
        with pytest.raises(ValueError):
            LogoStore(Path(".")).path(bad)

    assert store.delete("40536") is True
    assert store.get("40536") is None
    assert store.delete("40536") is False


def test_bundled_logos_are_shadowed_not_replaced(tmp_path, make_png):
    """An upload hides the bundled logo of the same name; deleting it brings the file back."""
    builtin, uploads = tmp_path / "assets", tmp_path / "logos"
    builtin.mkdir()
    bundled = make_png(4, 4)
    (builtin / "starlink.png").write_bytes(bundled)
    (builtin / "kari.png").write_bytes(bundled)
    store = LogoStore(uploads, builtin)

    assert [logo.name for logo in store.entries()] == ["kari", "starlink"]
    assert store.get("starlink").builtin is True
    assert store.has_builtin("starlink") is True and store.has_builtin("oneweb") is False

    uploaded = make_png(8, 8)
    store.save("starlink", uploaded)
    shadowing = store.get("starlink")
    assert shadowing.builtin is False and shadowing.size_bytes == len(uploaded)
    assert store.has_builtin("starlink") is True
    # Still one entry per name, and the bundled file is untouched on disk.
    assert [logo.name for logo in store.entries()] == ["kari", "starlink"]
    assert (builtin / "starlink.png").read_bytes() == bundled

    assert store.delete("starlink") is True
    assert store.get("starlink").builtin is True
    # Deleting again is a no-op: the bundled file is never removed.
    assert store.delete("starlink") is False
    assert (builtin / "starlink.png").is_file()
