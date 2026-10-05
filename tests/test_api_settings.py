"""Database settings endpoints."""

from soda.api.settings import mask_url


def test_database_settings_report_the_store_in_use(bare_client, tmp_path, monkeypatch):
    monkeypatch.delenv("SODA_DATABASE_URL", raising=False)
    status = bare_client.get("/api/v1/settings/database").json()
    assert status["backend"] == "sqlite"
    assert status["path"] == str((tmp_path / "soda.db").resolve())
    assert status["size_bytes"] > 0
    assert status["counts"]["stations"] == 1
    assert status["counts"]["sensor_presets"] == 0
    assert status["source"] == "default"
    assert status["restart_required"] is False
    assert status["editable"] is True


def test_database_settings_test_and_save(bare_client, tmp_path, monkeypatch):
    monkeypatch.delenv("SODA_DATABASE_URL", raising=False)
    target = tmp_path / "elsewhere" / "soda.db"
    url = f"sqlite:///{target.as_posix()}"
    probe = bare_client.post("/api/v1/settings/database/test", json={"url": url}).json()
    assert (probe["ok"], probe["exists"]) == (True, False)
    assert not target.exists()

    saved = bare_client.put("/api/v1/settings/database", json={"url": url}).json()
    assert saved["restart_required"] is True
    assert saved["next_url"] == url
    config = (tmp_path / "settings.local.toml").read_text(encoding="utf-8")
    assert config == f'database_url = "{url}"\n'

    # Going back to the default drops the key instead of pinning today's data_dir.
    reverted = bare_client.put("/api/v1/settings/database", json={"url": ""}).json()
    assert reverted["restart_required"] is False
    assert "database_url" not in (tmp_path / "settings.local.toml").read_text(encoding="utf-8")


def test_database_settings_refuse_bad_urls_and_env_overrides(bare_client, tmp_path, monkeypatch):
    monkeypatch.delenv("SODA_DATABASE_URL", raising=False)
    bad = bare_client.post("/api/v1/settings/database/test", json={"url": "postgresql://x/y"})
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "databaseUrlInvalid"
    junk = tmp_path / "junk.db"
    junk.write_text("not sqlite")
    refused = bare_client.put(
        "/api/v1/settings/database", json={"url": f"sqlite:///{junk.as_posix()}"}
    )
    assert refused.status_code == 422
    assert refused.json()["detail"]["code"] == "databaseProbeFailed"

    monkeypatch.setenv("SODA_DATABASE_URL", "sqlite:///env.db")
    locked = bare_client.put("/api/v1/settings/database", json={"url": ""})
    assert locked.status_code == 409
    assert locked.json()["detail"]["code"] == "databaseUrlFromEnv"
    assert not (tmp_path / "settings.local.toml").exists()


def test_mask_url_hides_passwords():
    assert mask_url("postgresql://me:secret@host/db") == "postgresql://me:***@host/db"
    assert mask_url("sqlite:///data/soda.db") == "sqlite:///data/soda.db"
