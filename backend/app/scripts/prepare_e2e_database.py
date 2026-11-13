"""Prepares the database of the end-to-end tests (D102).

Run inside the api container of `docker-compose.e2e.yml`, before the API starts:

    python -m app.scripts.prepare_e2e_database

It drops and recreates the database named in `DATABASE_URL`, applies the
migrations and restores the demo, whose dates are relative to today (D43).
It refuses, without connecting to anything, when the database name does not end
in `_e2e`: a wrong `DATABASE_URL` must never wipe the development data.
"""

import asyncio
import logging
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings, get_settings
from app.jobs.restore_demo import restore_demo

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
E2E_SUFFIX = "_e2e"


class UnsafeDatabaseError(Exception):
    """The database is not one dedicated to the end-to-end tests."""


def e2e_database_name(database_url: str) -> str:
    """Returns the database name, or raises when it does not end in `_e2e`."""
    name = make_url(database_url).database
    if not name or not name.endswith(E2E_SUFFIX):
        raise UnsafeDatabaseError(
            f"refusing to prepare {name!r}: the name must end in {E2E_SUFFIX}"
        )
    return name


async def recreate_database(database_url: str) -> None:
    name = e2e_database_name(database_url)
    server = create_async_engine(
        make_url(database_url).set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )
    try:
        async with server.connect() as connection:
            await connection.execute(
                text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            )
            await connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        await server.dispose()


def migrate(database_url: str) -> None:
    """Runs Alembic in a subprocess, with the URL already checked."""
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": database_url},
        check=True,
    )


async def prepare(settings: Settings) -> None:
    """Checks the name before anything else, then recreates, migrates and restores."""
    database_url = settings.database_url
    e2e_database_name(database_url)
    await recreate_database(database_url)
    migrate(database_url)
    engine = create_async_engine(database_url, poolclass=NullPool, hide_parameters=True)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            await restore_demo(session, settings, datetime.now(UTC))
    finally:
        await engine.dispose()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    try:
        asyncio.run(prepare(get_settings()))
    except UnsafeDatabaseError as exc:
        logger.error("%s", exc)
        raise SystemExit(1) from None
    logger.info("e2e database ready")


if __name__ == "__main__":
    main()
