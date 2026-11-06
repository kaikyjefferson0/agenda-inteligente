"""PostgreSQL cannot store a null character, so it must never reach the database."""

from typing import Any

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, Service, TimeBlock
from tests.auth.helpers import API, bearer, invite, register_body
from tests.configuration.helpers import Member, create_service

pytestmark = mark.anyio

NULL_NAME = "Marcador\x00Unico"


def assert_refused(response: Response) -> None:
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


@mark.parametrize(
    "body",
    [
        register_body(name=NULL_NAME),
        {
            **register_body(),
            "business": {**register_body()["business"], "name": NULL_NAME},
        },
    ],
    ids=["owner", "business"],
)
async def test_register_refuses_a_null_character(
    client: AsyncClient, db: AsyncSession, body: dict[str, Any]
) -> None:
    assert_refused(await client.post(f"{API}/auth/register", json=body))
    assert await db.scalar(select(func.count()).select_from(Business)) == 0


async def test_business_name_refuses_a_null_character(
    client: AsyncClient, owner_token: str
) -> None:
    response = await client.patch(
        f"{API}/business", json={"name": NULL_NAME}, headers=bearer(owner_token)
    )

    assert_refused(response)


async def test_new_service_refuses_a_null_character(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    response = await client.post(
        f"{API}/services",
        json={"name": NULL_NAME, "duration_minutes": 30, "price_cents": 100},
        headers=bearer(owner_token),
    )

    assert_refused(response)
    assert await db.scalar(select(func.count()).select_from(Service)) == 0


async def test_service_edit_refuses_a_null_character(
    client: AsyncClient, owner_token: str
) -> None:
    service = await create_service(client, owner_token)

    response = await client.patch(
        f"{API}/services/{service['id']}",
        json={"name": NULL_NAME},
        headers=bearer(owner_token),
    )

    assert_refused(response)


async def test_invitation_refuses_a_null_character(
    client: AsyncClient, owner_token: str
) -> None:
    assert_refused(await invite(client, owner_token, name=NULL_NAME))


async def test_time_block_reason_refuses_a_null_character(
    client: AsyncClient, db: AsyncSession, pro: Member
) -> None:
    response = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": "2030-01-07T10:00:00Z",
            "ends_at": "2030-01-07T11:00:00Z",
            "reason": "Folga\x00",
        },
        headers=bearer(pro.token),
    )

    assert_refused(response)
    assert await db.scalar(select(func.count()).select_from(TimeBlock)) == 0


async def test_the_refusal_does_not_echo_the_value(
    client: AsyncClient, owner_token: str
) -> None:
    response = await invite(client, owner_token, name=NULL_NAME)

    assert "Marcador" not in response.text
