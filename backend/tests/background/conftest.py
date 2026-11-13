from pydantic import SecretStr
from pytest import fixture
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.email.fake import FakeSender
from tests.demo.helpers import DEMO_PASSWORD


@fixture
def settings(settings: Settings) -> Settings:
    """Both tasks off, as in every environment but production (D105, D106)."""
    return settings.model_copy(
        update={
            "demo_password": SecretStr(DEMO_PASSWORD),
            "email_worker_in_process": False,
            "demo_restore_in_process": False,
        }
    )


@fixture
def sender() -> FakeSender:
    return FakeSender()


@fixture
def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """The tasks' own sessions, apart from the `db` of the assertions."""
    return async_sessionmaker(engine, expire_on_commit=False)
