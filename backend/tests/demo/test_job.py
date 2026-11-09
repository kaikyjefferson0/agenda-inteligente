"""`python -m app.jobs.restore_demo`: the exit code and the logs of `main()`.

`main()` runs its own event loop, so these tests are synchronous. The engine
points to the test database: `get_engine()` would reach the development one.
"""

import logging

from pydantic import SecretStr
from pytest import LogCaptureFixture, MonkeyPatch, raises
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.jobs import restore_demo
from tests.conftest import CountingPasswordHasher


def _patch(monkeypatch: MonkeyPatch, database_url: str, settings: Settings) -> None:
    monkeypatch.setattr(
        restore_demo,
        "get_engine",
        lambda: create_async_engine(database_url, poolclass=NullPool),
    )
    monkeypatch.setattr(restore_demo, "get_settings", lambda: settings)


def test_main_exits_with_0_after_restoring(
    monkeypatch: MonkeyPatch,
    migrated_database_url: str,
    settings: Settings,
    hasher: type[CountingPasswordHasher],
    caplog: LogCaptureFixture,
) -> None:
    _patch(monkeypatch, migrated_database_url, settings)

    with caplog.at_level(logging.INFO), raises(SystemExit) as exit_info:
        restore_demo.main()

    assert exit_info.value.code == 0
    assert "demo restored in" in caplog.text


def test_main_exits_with_1_when_refused(
    monkeypatch: MonkeyPatch,
    migrated_database_url: str,
    settings: Settings,
    caplog: LogCaptureFixture,
) -> None:
    short = settings.model_copy(update={"demo_password": SecretStr("curta")})
    _patch(monkeypatch, migrated_database_url, short)

    with caplog.at_level(logging.INFO), raises(SystemExit) as exit_info:
        restore_demo.main()

    assert exit_info.value.code == 1
    assert "demo restore refused: DEMO_PASSWORD must have 12 to 128" in caplog.text
    assert "curta" not in caplog.text
