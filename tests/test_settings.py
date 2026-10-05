import tomllib
from pathlib import Path

from soda.settings import Settings, write_local_setting


def test_database_url_defaults_to_sqlite_in_data_dir(monkeypatch):
    monkeypatch.delenv("SODA_DATABASE_URL", raising=False)
    assert Settings(data_dir=Path("data")).resolved_database_url == "sqlite:///data/soda.db"
    assert Settings(data_dir=Path("/srv/soda")).resolved_database_url == (
        "sqlite:////srv/soda/soda.db"
    )


def test_database_url_from_toml_then_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("SODA_DATABASE_URL", raising=False)
    config = tmp_path / "settings.toml"
    config.write_text('database_url = "sqlite:///from-toml.db"\n', encoding="utf-8")
    settings = Settings.read(config)
    assert settings.resolved_database_url == "sqlite:///from-toml.db"
    assert (settings.database_source, settings.source_path) == ("toml", config)
    monkeypatch.setenv("SODA_DATABASE_URL", "sqlite:///from-env.db")
    settings = Settings.read(config)
    assert settings.resolved_database_url == "sqlite:///from-env.db"
    assert settings.database_source == "env"


def test_database_source_defaults(tmp_path, monkeypatch):
    monkeypatch.delenv("SODA_DATABASE_URL", raising=False)
    config = tmp_path / "settings.toml"
    config.write_text("auto_refresh = false\n", encoding="utf-8")
    assert Settings.read(config).database_source == "default"


def test_write_local_setting_inserts_before_the_first_table(tmp_path):
    config = tmp_path / "settings.toml"
    config.write_text(
        '# my notes\nauto_refresh = false\n\n[spacetrack]\nusername = "me"\n',
        encoding="utf-8",
    )
    write_local_setting(config, "database_url", "sqlite:///C:\\db\\soda.db")
    text = config.read_text(encoding="utf-8")
    assert text.startswith("# my notes\nauto_refresh = false\n\ndatabase_url = ")
    parsed = tomllib.loads(text)
    assert parsed["database_url"] == "sqlite:///C:\\db\\soda.db"
    assert parsed["spacetrack"] == {"username": "me"}


def test_write_local_setting_replaces_and_removes_in_place(tmp_path):
    config = tmp_path / "settings.toml"
    config.write_text(
        'database_url = "sqlite:///old.db"  # old\n# keep me\n[spacetrack]\n'
        'database_url = "not top level"\n',
        encoding="utf-8",
    )
    write_local_setting(config, "database_url", "sqlite:///new.db")
    lines = config.read_text(encoding="utf-8").splitlines()
    assert lines[:2] == ['database_url = "sqlite:///new.db"', "# keep me"]
    assert lines[-1] == 'database_url = "not top level"'
    write_local_setting(config, "database_url", "")
    parsed = tomllib.loads(config.read_text(encoding="utf-8"))
    assert "database_url" not in parsed
    assert parsed["spacetrack"]["database_url"] == "not top level"


def test_write_local_setting_creates_the_file(tmp_path):
    config = tmp_path / "nested" / "settings.local.toml"
    write_local_setting(config, "database_url", "sqlite:///x.db")
    assert tomllib.loads(config.read_text(encoding="utf-8")) == {"database_url": "sqlite:///x.db"}


def test_port_from_toml_then_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("SODA_PORT", raising=False)
    monkeypatch.delenv("SODA_BIND", raising=False)
    config = tmp_path / "settings.toml"
    config.write_text("auto_refresh = false\n", encoding="utf-8")
    assert (Settings.read(config).bind, Settings.read(config).port) == ("127.0.0.1", 1992)
    config.write_text('bind = "0.0.0.0"\nport = 2002\n', encoding="utf-8")
    assert (Settings.read(config).bind, Settings.read(config).port) == ("0.0.0.0", 2002)
    monkeypatch.setenv("SODA_PORT", "2001")
    monkeypatch.setenv("SODA_BIND", "127.0.0.2")
    assert (Settings.read(config).bind, Settings.read(config).port) == ("127.0.0.2", 2001)


def test_sample_imagery_points_at_the_submodule_unless_switched_off(tmp_path):
    from soda.settings import SAMPLES_DIR

    config = tmp_path / "settings.toml"
    config.write_text("auto_refresh = false\n", encoding="utf-8")
    assert Settings.read(config).imagery_samples_dir == SAMPLES_DIR
    assert SAMPLES_DIR.parts[-2:] == ("samples", "imagery")
    config.write_text("imagery_samples = false\n", encoding="utf-8")
    assert Settings.read(config).imagery_samples_dir is None
    # Built directly, as the tests do, there are no samples to trip over.
    assert Settings().imagery_samples_dir is None
