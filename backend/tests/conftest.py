import asyncio
import os
import subprocess
import sys
from pathlib import Path

from pytest import fixture
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

BACKEND_DIR = Path(__file__).resolve().parent.parent


def database_url_for(name: str) -> str:
    """Returns the Compose server's URL for a database dedicated to the tests.

    The suffix guarantees the migration tests never touch the development data.
    """
    assert name.endswith("_test"), "test databases must end in _test"
    url = make_url(get_settings().database_url)
    return url.set(database=name).render_as_string(hide_password=False)


def recreate_database(name: str) -> str:
    async def recreate() -> None:
        engine = create_async_engine(
            make_url(database_url_for(name)).set(database="postgres"),
            isolation_level="AUTOCOMMIT",
            poolclass=NullPool,
        )
        async with engine.connect() as connection:
            await connection.execute(
                text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            )
            await connection.execute(text(f'CREATE DATABASE "{name}"'))
        await engine.dispose()

    asyncio.run(recreate())
    return database_url_for(name)


def run_alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Runs Alembic in a subprocess.

    `get_settings()` is cached, so running it in-process could reuse the
    development URL and apply a downgrade to the wrong database.
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": database_url},
        capture_output=True,
        text=True,
    )


@fixture(scope="session")
def migrated_database_url() -> str:
    database_url = recreate_database("agenda_test")
    result = run_alembic(database_url, "upgrade", "head")
    assert result.returncode == 0, result.stderr
    return database_url
