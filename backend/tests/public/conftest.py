from datetime import datetime
from typing import Any

from httpx import AsyncClient
from pytest import fixture
from sqlalchemy.ext.asyncio import AsyncSession

from tests.auth.helpers import Clock, register_owner
from tests.configuration.helpers import (
    MONDAY,
    Member,
    add_member,
    create_service,
    interval,
    next_local,
    put_hours,
    start_serving,
)
from tests.public.helpers import OTHER_SLUG, link_services


@fixture
async def owner_token(client: AsyncClient) -> str:
    return (await register_owner(client)).json()["access_token"]


@fixture
async def service(client: AsyncClient, owner_token: str) -> dict[str, Any]:
    return await create_service(client, owner_token)


async def _make_serving(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    email: str,
    service: dict[str, Any],
) -> Member:
    """Bookable, serving the service, and working on Mondays from 09:00 to 18:00."""
    member = await add_member(client, db, owner_token, email)
    await link_services(client, owner_token, member.professional_id, service["id"])
    hours = await put_hours(
        client,
        owner_token,
        member.professional_id,
        interval(MONDAY, "09:00", "18:00"),
    )
    assert hours.status_code == 200, hours.text
    return member


@fixture
async def pro(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
) -> Member:
    return await _make_serving(client, db, owner_token, "pro@example.com", service)


@fixture
async def colleague(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    pro: Member,
    service: dict[str, Any],
) -> Member:
    """Registered after `pro`, so a tie in RN10 goes to `pro`."""
    return await _make_serving(client, db, owner_token, "colega@example.com", service)


@fixture
def monday_10(clock: Clock) -> datetime:
    return next_local(clock.now, MONDAY, "10:00")


@fixture
async def other_business(client: AsyncClient, owner_token: str) -> dict[str, Any]:
    """Another business, with a service and a professional who serves it."""
    registered = await register_owner(client, OTHER_SLUG, "outra-dona@example.com")
    token = registered.json()["access_token"]
    other_service = await create_service(client, token, name="Outro serviço")
    other_professional = await start_serving(client, token)
    await link_services(client, token, other_professional["id"], other_service["id"])
    hours = await put_hours(
        client, token, other_professional["id"], interval(MONDAY, "09:00", "18:00")
    )
    assert hours.status_code == 200, hours.text
    return {
        "token": token,
        "service_id": other_service["id"],
        "professional_id": other_professional["id"],
    }
