import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from argon2 import PasswordHasher
from httpx import ASGITransport, AsyncClient
from pytest import MonkeyPatch, fixture
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.api.deps import get_now
from app.core import security
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.main import app
from tests.auth.helpers import Clock

BACKEND_DIR = Path(__file__).resolve().parent.parent
TRUNCATE_ALL = text(
    "TRUNCATE businesses, email_outbox, rate_limit_counters RESTART IDENTITY CASCADE"
)


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


class CountingPasswordHasher(PasswordHasher):
    """Cheap parameters keep the suite fast, and the counter proves the work done."""

    verify_calls = 0

    def verify(self, hash: str | bytes, password: str | bytes) -> bool:
        type(self).verify_calls += 1
        return super().verify(hash, password)


@fixture
def anyio_backend() -> str:
    return "asyncio"


@fixture
def hasher(monkeypatch: MonkeyPatch) -> type[CountingPasswordHasher]:
    CountingPasswordHasher.verify_calls = 0
    light = CountingPasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    monkeypatch.setattr(security, "_hasher", light)
    monkeypatch.setattr(security, "_dummy_hash", None)
    return CountingPasswordHasher


@fixture
def clock() -> Clock:
    """Frozen by default, so no test straddles a rate limit window by accident."""
    return Clock(datetime.now(UTC).replace(microsecond=0))


@fixture
def settings() -> Settings:
    return get_settings().model_copy(
        update={
            "registration_enabled": True,
            "frontend_base_url": "https://app.test",
            "trusted_client_ip_header": "",
            "email_daily_cap": 100,
            "email_recipient_daily_cap": 3,
        }
    )


@fixture
async def engine(migrated_database_url: str) -> AsyncIterator[AsyncEngine]:
    """Commits are real here, because transactions and locks are under test."""
    test_engine = create_async_engine(migrated_database_url, poolclass=NullPool)
    async with test_engine.begin() as connection:
        await connection.execute(TRUNCATE_ALL)
    yield test_engine
    async with test_engine.begin() as connection:
        await connection.execute(TRUNCATE_ALL)
    await test_engine.dispose()


@fixture
async def db(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Session for arranging and inspecting state, apart from the API's sessions."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session


@fixture
async def client(
    engine: AsyncEngine,
    clock: Clock,
    settings: Settings,
    hasher: type[CountingPasswordHasher],
) -> AsyncIterator[AsyncClient]:
    async def override_session() -> AsyncIterator[AsyncSession]:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_now] = lambda: clock.now
    # https: the refresh cookie is always Secure.
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test"
    ) as test_client:
        yield test_client
    app.dependency_overrides.clear()
