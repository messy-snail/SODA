import logging
import struct
from pathlib import Path

import pytest

from soda.models3d import GlbError, ModelStore, is_valid_name, validate_glb

ASSET = {"asset": {"version": "2.0"}}


def test_model_names():
    assert is_valid_name("default") and is_valid_name("25544") and is_valid_name("340000")
    for name in ("", "0", "025544", "1234567890", "../default", "default.glb", "DEFAULT"):
        assert not is_valid_name(name)
    with pytest.raises(ValueError):
        ModelStore(Path(".")).path("..")


def test_operator_names_stay_out_of_the_model_store():
    """Operator slugs are a logo-only rule; models keep default/NORAD names."""
    assert not is_valid_name("starlink")
    with pytest.raises(ValueError):
        ModelStore(Path(".")).path("starlink")


def test_validate_glb_accepts_embedded_data(make_glb):
    validate_glb(make_glb(ASSET))
    embedded = {**ASSET, "images": [{"uri": "data:image/png;base64,AA=="}, {"bufferView": 0}]}
    validate_glb(make_glb(embedded))


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda glb: glb[:10], "glbNotGlb"),
        (lambda glb: b"JUNK" + glb[4:], "glbNotGlb"),
        (lambda glb: glb[:4] + struct.pack("<I", 1) + glb[8:], "glbVersion"),
        (lambda glb: glb + b"    ", "glbLengthMismatch"),
        (lambda glb: glb[:16] + b"BIN\x00" + glb[20:], "glbJsonChunk"),
    ],
)
def test_validate_glb_rejects_broken_files(make_glb, mutate, code):
    with pytest.raises(GlbError) as caught:
        validate_glb(mutate(make_glb(ASSET)))
    assert caught.value.code == code


def test_validate_glb_rejects_external_references(make_glb):
    for key in ("buffers", "images"):
        document = {**ASSET, key: [{"uri": "texture.png"}]}
        with pytest.raises(GlbError) as caught:
            validate_glb(make_glb(document))
        assert caught.value.code == "glbExternalUri"
    with pytest.raises(GlbError) as caught:
        validate_glb(make_glb([1, 2, 3]))  # type: ignore[arg-type]
    assert caught.value.code == "glbJsonChunk"


def test_store_round_trip(tmp_path, make_glb, caplog):
    store = ModelStore(tmp_path / "models")
    assert store.entries() == [] and store.get("default") is None
    glb = make_glb(ASSET)
    store.save("25544", glb)
    store.save("default", glb)
    store.save("1000", glb)
    assert [model.name for model in store.entries()] == ["default", "1000", "25544"]
    model = store.get("25544")
    assert model.norad_id == 25544 and model.size_bytes == len(glb)
    assert model.updated_at.tzinfo is not None
    assert not list((tmp_path / "models").glob("*.tmp"))

    with pytest.raises(GlbError):
        store.save("25544", b"not a model")
    assert store.path("25544").read_bytes() == glb

    assert store.read_settings("25544") == {}
    store.save_settings("25544", {"scale": 2.0})
    assert store.read_settings("25544") == {"scale": 2.0}
    store._settings_path("1000").write_text("{broken", encoding="utf-8")
    with caplog.at_level(logging.WARNING):
        assert store.read_settings("1000") == {}
    assert "unreadable model settings" in caplog.text

    assert store.delete("25544") is True
    assert not store.path("25544").exists() and not store._settings_path("25544").exists()
    assert store.delete("25544") is False
