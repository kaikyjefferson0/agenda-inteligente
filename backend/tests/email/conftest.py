from pytest import fixture
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.email.fake import FakeSender
from tests.public.conftest import (  # noqa: F401
    monday_10,
    owner_token,
    pro,
    service,
)


@fixture
def sender() -> FakeSender:
    return FakeSender()


@fixture
def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """The worker's own sessions, apart from the `db` of the assertions."""
    return async_sessionmaker(engine, expire_on_commit=False)
