from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    # hide_parameters: statements carry password hashes and raw links for the
    # outbox, and database errors end up in the logs.
    return create_async_engine(
        get_settings().database_url, pool_pre_ping=True, hide_parameters=True
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_sessionmaker(get_engine(), expire_on_commit=False)() as session:
        yield session
