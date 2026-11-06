from httpx import AsyncClient
from pytest import fixture
from sqlalchemy.ext.asyncio import AsyncSession

from tests.auth.helpers import register_owner
from tests.configuration.helpers import Member, add_member

OTHER_OWNER_EMAIL = "outra-dona@example.com"


@fixture
async def owner_token(client: AsyncClient) -> str:
    return (await register_owner(client)).json()["access_token"]


@fixture
async def other_owner_token(client: AsyncClient, owner_token: str) -> str:
    response = await register_owner(client, "outro-negocio", OTHER_OWNER_EMAIL)
    return response.json()["access_token"]


@fixture
async def pro(client: AsyncClient, db: AsyncSession, owner_token: str) -> Member:
    return await add_member(client, db, owner_token, "pro@example.com")


@fixture
async def colleague(client: AsyncClient, db: AsyncSession, owner_token: str) -> Member:
    return await add_member(client, db, owner_token, "colega@example.com")
