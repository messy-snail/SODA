"""Uploaded 3D model and logo endpoints."""


def test_models(bare_client, tmp_path, make_glb):
    glb = make_glb({"asset": {"version": "2.0"}})
    assert bare_client.get("/api/v1/models").json() == []

    uploaded = bare_client.put(
        "/api/v1/models/25544",
        content=glb,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert uploaded.status_code == 200
    info = uploaded.json()
    assert info["name"] == "25544" and info["norad_id"] == 25544
    assert info["size_bytes"] == len(glb) and info["updated_at"].endswith("Z")
    assert info["settings"] == {
        "heading_deg": 0.0,
        "pitch_deg": 0.0,
        "roll_deg": 0.0,
        "scale": 1.0,
        "minimum_size_px": 48.0,
    }
    assert bare_client.put("/api/v1/models/default", content=glb).json()["norad_id"] is None
    assert [m["name"] for m in bare_client.get("/api/v1/models").json()] == ["default", "25544"]

    file = bare_client.get("/api/v1/models/25544.glb")
    assert file.status_code == 200 and file.content == glb
    assert file.headers["content-type"] == "model/gltf-binary"

    settings = {
        "heading_deg": 90,
        "pitch_deg": 0,
        "roll_deg": -45,
        "scale": 2,
        "minimum_size_px": 64,
    }
    saved = bare_client.put("/api/v1/models/25544/settings", json=settings).json()
    assert saved["settings"]["heading_deg"] == 90 and saved["settings"]["minimum_size_px"] == 64
    assert bare_client.get("/api/v1/models").json()[1]["settings"]["scale"] == 2

    assert bare_client.delete("/api/v1/models/25544").status_code == 204
    assert not (tmp_path / "models" / "25544.json").exists()
    assert bare_client.get("/api/v1/models/25544.glb").status_code == 404
    assert bare_client.delete("/api/v1/models/25544").status_code == 404


def test_model_validation(bare_client, make_glb, monkeypatch):
    glb = make_glb({"asset": {"version": "2.0"}})
    for name in ("abc", "0", "025544"):
        response = bare_client.put(f"/api/v1/models/{name}", content=glb)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "modelBadName"
    assert bare_client.get("/api/v1/models/abc.glb").status_code == 404

    broken = bare_client.put("/api/v1/models/25544", content=b"not a model file at all")
    assert broken.status_code == 422 and broken.json()["detail"]["code"] == "glbNotGlb"
    external = make_glb({"asset": {"version": "2.0"}, "buffers": [{"uri": "mesh.bin"}]})
    response = bare_client.put("/api/v1/models/25544", content=external)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "glbExternalUri"

    monkeypatch.setattr("soda.api.models3d.MAX_MODEL_BYTES", len(glb) - 1)
    too_large = bare_client.put("/api/v1/models/25544", content=glb)
    assert too_large.status_code == 413
    assert too_large.json()["detail"]["code"] == "modelTooLarge"
    monkeypatch.undo()

    assert bare_client.put("/api/v1/models/25544/settings", json={}).status_code == 404
    bare_client.put("/api/v1/models/25544", content=glb)
    assert bare_client.put("/api/v1/models/25544/settings", json={"scale": 0}).status_code == 422
    assert bare_client.put("/api/v1/models/25544/settings", json={}).status_code == 200


def test_logos(bare_client, tmp_path, make_png):
    png = make_png()
    assert bare_client.get("/api/v1/logos").json() == []

    uploaded = bare_client.put(
        "/api/v1/logos/40536", content=png, headers={"Content-Type": "image/png"}
    )
    assert uploaded.status_code == 200
    info = uploaded.json()
    assert info == {
        "name": "40536",
        "norad_id": 40536,
        "operator": None,
        "builtin": False,
        "has_builtin": False,
        "size_bytes": len(png),
        "updated_at": info["updated_at"],
    }
    assert info["updated_at"].endswith("Z")
    assert bare_client.put("/api/v1/logos/default", content=png).json()["norad_id"] is None
    operator = bare_client.put("/api/v1/logos/telepix", content=png).json()
    assert operator["operator"] == "telepix" and operator["norad_id"] is None
    assert [logo["name"] for logo in bare_client.get("/api/v1/logos").json()] == [
        "default",
        "telepix",
        "40536",
    ]

    file = bare_client.get("/api/v1/logos/40536.png")
    assert file.status_code == 200 and file.content == png
    assert file.headers["content-type"] == "image/png"

    assert bare_client.delete("/api/v1/logos/40536").status_code == 204
    assert not (tmp_path / "logos" / "40536.png").exists()
    assert bare_client.get("/api/v1/logos/40536.png").status_code == 404
    assert bare_client.delete("/api/v1/logos/40536").status_code == 404


def test_builtin_logos(bare_client, builtin_logos, tmp_path, make_png):
    """A bundled logo is listed and served; an upload shadows it and deleting restores it."""
    bundled, uploaded = make_png(4, 4), make_png(8, 8)
    builtin_logos.mkdir()
    (builtin_logos / "kari.png").write_bytes(bundled)

    listed = bare_client.get("/api/v1/logos").json()
    assert [logo["name"] for logo in listed] == ["kari"]
    assert listed[0]["builtin"] is True and listed[0]["has_builtin"] is True
    assert bare_client.get("/api/v1/logos/kari.png").content == bundled

    # A bundled logo has no upload to remove.
    refused = bare_client.delete("/api/v1/logos/kari")
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "logoBuiltinLocked"

    shadowing = bare_client.put("/api/v1/logos/kari", content=uploaded).json()
    assert shadowing["builtin"] is False and shadowing["has_builtin"] is True
    assert bare_client.get("/api/v1/logos/kari.png").content == uploaded

    assert bare_client.delete("/api/v1/logos/kari").status_code == 204
    assert bare_client.get("/api/v1/logos/kari.png").content == bundled
    assert (builtin_logos / "kari.png").is_file()


def test_logo_validation(bare_client, make_png, monkeypatch):
    png = make_png()
    for name in ("KARI", "0", "040536", "x"):
        response = bare_client.put(f"/api/v1/logos/{name}", content=png)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "logoBadName"
    assert bare_client.get("/api/v1/logos/KARI.png").status_code == 404

    broken = bare_client.put("/api/v1/logos/40536", content=b"<svg xmlns='...'></svg>")
    assert broken.status_code == 422 and broken.json()["detail"]["code"] == "logoNotPng"

    monkeypatch.setattr("soda.api.logos.MAX_LOGO_BYTES", len(png) - 1)
    too_large = bare_client.put("/api/v1/logos/40536", content=png)
    assert too_large.status_code == 413
    assert too_large.json()["detail"]["code"] == "logoTooLarge"
