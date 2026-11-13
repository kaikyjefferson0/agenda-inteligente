"""`python -m app.scripts.prepare_e2e_database`: the guard and the recreation (D102).

`main()` runs its own event loop, so these tests are synchronous, like the ones
of the restoration job.
"""

import asyncio
import logging
from collections.abc import Iterator

from pytest import LogCaptureFixture, MonkeyPatch, fixture, mark, raises
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.scripts import prepare_e2e_database as script
from app.services import demo_content
from tests.conftest import CountingPasswordHasher

E2E_NAME = "agenda_prepare_e2e"
# Nothing listens on port 1: a refused guard never gets to connect.
UNREACHABLE = "postgresql+asyncpg://agenda:x@127.0.0.1:1/{name}"


@mark.parametrize("name", ["agenda", "agenda_test", "agenda_e2e_copia", ""])
def test_refuses_a_database_not_dedicated_to_the_e2e(name: str) -> None:
    with raises(script.UnsafeDatabaseError):
        script.e2e_database_name(UNREACHABLE.format(name=name))


def test_accepts_a_name_ending_in_e2e() -> None:
    assert script.e2e_database_name(UNREACHABLE.format(name="agenda_e2e")) == (
        "agenda_e2e"
    )


def test_main_exits_with_1_before_connecting(
    monkeypatch: MonkeyPatch, settings: Settings, caplog: LogCaptureFixture
) -> None:
    unsafe = settings.model_copy(
        update={"database_url": UNREACHABLE.format(name="agenda")}
    )
    monkeypatch.setattr(script, "get_settings", lambda: unsafe)

    with caplog.at_level(logging.ERROR), raises(SystemExit) as exit_info:
        script.main()

    assert exit_info.value.code == 1
    assert "must end in _e2e" in caplog.text


async def _drop(database_url: str) -> None:
    server = create_async_engine(
        make_url(database_url).set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )
    async with server.connect() as connection:
        await connection.execute(
            text(f'DROP DATABASE IF EXISTS "{E2E_NAME}" WITH (FORCE)')
        )
    await server.dispose()


async def _execute(database_url: str, statement: str) -> None:
    engine = create_async_engine(database_url, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(text(statement))
    await engine.dispose()


async def _scalar(database_url: str, query: str) -> object:
    engine = create_async_engine(database_url, poolclass=NullPool)
    async with engine.begin() as connection:
        value = (await connection.execute(text(query))).scalar()
    await engine.dispose()
    return value


@fixture
def e2e_url(migrated_database_url: str) -> Iterator[str]:
    url = make_url(migrated_database_url).set(database=E2E_NAME)
    rendered = url.render_as_string(hide_password=False)
    yield rendered
    asyncio.run(_drop(rendered))


def test_recreates_migrates_and_restores_the_demo(
    monkeypatch: MonkeyPatch,
    settings: Settings,
    e2e_url: str,
    hasher: type[CountingPasswordHasher],
) -> None:
    e2e_settings = settings.model_copy(update={"database_url": e2e_url})
    monkeypatch.setattr(script, "get_settings", lambda: e2e_settings)

    script.main()
    asyncio.run(_execute(e2e_url, "CREATE TABLE leftover (id int)"))
    script.main()

    assert asyncio.run(_scalar(e2e_url, "SELECT to_regclass('leftover')")) is None
    slug = asyncio.run(_scalar(e2e_url, "SELECT slug FROM businesses WHERE is_demo"))
    assert slug == demo_content.SLUG
