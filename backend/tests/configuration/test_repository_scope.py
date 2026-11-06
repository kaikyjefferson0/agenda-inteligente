"""Checks the mandatory business_id of the repositories directly.

The services look at the business in more than one place, so a filter missing from
a single repository function does not change any HTTP response, which is what CT19
observes. Each function here gets the ID of another business instead.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from httpx import AsyncClient
from pytest import fixture, mark, raises
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models import Professional
from app.repositories import (
    appointments,
    catalog,
    professionals,
    time_blocks,
    working_hours,
)
from tests.auth.helpers import API, Clock, bearer, get_user
from tests.configuration.helpers import (
    MONDAY,
    Member,
    create_service,
    get_business,
    interval,
    make_appointment,
    next_local,
    put_hours,
)

pytestmark = mark.anyio


IDEMPOTENCY_KEY = "8f14e45f-ceea-467f-a9f7-1d2e3c4b5a69"


@dataclass
class Scene:
    appointment_id: UUID
    business_id: UUID
    other_business_id: UUID
    professional_id: UUID
    user_id: UUID
    service_id: UUID
    time_block_id: UUID
    starts_at: datetime
    now: datetime


@fixture
async def scene(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    other_owner_token: str,
    pro: Member,
) -> Scene:
    service = await create_service(client, owner_token)
    linked = await client.put(
        f"{API}/professionals/{pro.professional_id}/services",
        json={"service_ids": [service["id"]]},
        headers=bearer(owner_token),
    )
    assert linked.status_code == 200
    hours = await put_hours(
        client, owner_token, pro.professional_id, interval(MONDAY, "09:00", "12:00")
    )
    assert hours.status_code == 200
    starts_at = next_local(clock.now, MONDAY, "10:00")
    block = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": (starts_at + timedelta(hours=1)).isoformat(),
            "ends_at": (starts_at + timedelta(hours=2)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(owner_token),
    )
    assert block.status_code == 201
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], starts_at
    )
    appointment.idempotency_key = IDEMPOTENCY_KEY
    appointment.idempotency_fingerprint = "fingerprint-de-teste"
    await db.commit()
    return Scene(
        appointment_id=appointment.id,
        business_id=(await get_business(db)).id,
        other_business_id=(await get_business(db, "outro-negocio")).id,
        professional_id=UUID(pro.professional_id),
        user_id=(await get_user(db, pro.email)).id,
        service_id=UUID(service["id"]),
        time_block_id=UUID(block.json()["id"]),
        starts_at=starts_at,
        now=clock.now,
    )


Reader = Callable[[AsyncSession, UUID, Scene], Awaitable[Any]]

READERS: dict[str, Reader] = {
    "professionals.get": lambda db, business_id, s: professionals.get(
        db, business_id, s.professional_id
    ),
    "professionals.get_by_user": lambda db, business_id, s: professionals.get_by_user(
        db, business_id, s.user_id
    ),
    "professionals.lock": lambda db, business_id, s: professionals.lock(
        db, business_id, s.professional_id
    ),
    "professionals.list_with_users": lambda db, business_id, s: (
        professionals.list_with_users(db, business_id)
    ),
    "professionals.list_with_users, by id": lambda db, business_id, s: (
        professionals.list_with_users(
            db, business_id, professional_id=s.professional_id
        )
    ),
    "professionals.list_service_ids": lambda db, business_id, s: (
        professionals.list_service_ids(db, business_id)
    ),
    "professionals.list_eligible": lambda db, business_id, s: (
        professionals.list_eligible(db, business_id, s.service_id)
    ),
    "professionals.list_public_links": lambda db, business_id, s: (
        professionals.list_public_links(db, business_id)
    ),
    "catalog.list_active": lambda db, business_id, s: catalog.list_active(
        db, business_id
    ),
    "time_blocks.busy_periods": lambda db, business_id, s: time_blocks.busy_periods(
        db,
        business_id,
        [s.professional_id],
        s.starts_at,
        s.starts_at + timedelta(hours=2),
    ),
    "appointments.busy_periods": lambda db, business_id, s: appointments.busy_periods(
        db,
        business_id,
        [s.professional_id],
        s.starts_at,
        s.starts_at + timedelta(hours=2),
    ),
    "appointments.count_by_professional": lambda db, business_id, s: (
        appointments.count_by_professional(
            db,
            business_id,
            [s.professional_id],
            s.starts_at,
            s.starts_at + timedelta(hours=2),
        )
    ),
    "appointments.lock": lambda db, business_id, s: appointments.lock(
        db, business_id, s.appointment_id
    ),
    "appointments.get_by_idempotency_key": lambda db, business_id, s: (
        appointments.get_by_idempotency_key(db, business_id, IDEMPOTENCY_KEY)
    ),
    "catalog.list_all": lambda db, business_id, s: catalog.list_all(db, business_id),
    "catalog.get": lambda db, business_id, s: catalog.get(
        db, business_id, s.service_id
    ),
    "catalog.count_existing": lambda db, business_id, s: catalog.count_existing(
        db, business_id, [s.service_id]
    ),
    "working_hours.list_for_professional": lambda db, business_id, s: (
        working_hours.list_for_professional(db, business_id, s.professional_id)
    ),
    "working_hours.list_for_business": lambda db, business_id, s: (
        working_hours.list_for_business(db, business_id)
    ),
    "time_blocks.list_for_professional": lambda db, business_id, s: (
        time_blocks.list_for_professional(db, business_id, s.professional_id)
    ),
    "time_blocks.get": lambda db, business_id, s: time_blocks.get(
        db, business_id, s.time_block_id
    ),
    "appointments.list_future_confirmed": lambda db, business_id, s: (
        appointments.list_future_confirmed(db, business_id, s.now)
    ),
    "appointments.list_occupying": lambda db, business_id, s: (
        appointments.list_occupying(
            db,
            business_id,
            s.professional_id,
            s.starts_at,
            s.starts_at + timedelta(minutes=30),
        )
    ),
}


@mark.parametrize("name", READERS)
async def test_readers_only_see_the_business_they_receive(
    db: AsyncSession, scene: Scene, name: str
) -> None:
    reader = READERS[name]

    # The first assertion keeps the second one from passing on an empty database.
    assert await reader(db, scene.business_id, scene)
    assert not await reader(db, scene.other_business_id, scene)


async def test_removing_a_time_block_needs_its_business(
    db: AsyncSession, scene: Scene
) -> None:
    removed = await time_blocks.remove(db, scene.other_business_id, scene.time_block_id)

    assert removed is False
    assert await time_blocks.get(db, scene.business_id, scene.time_block_id)


async def test_replacing_services_needs_the_business(
    db: AsyncSession, scene: Scene
) -> None:
    await professionals.replace_services(
        db, scene.other_business_id, scene.professional_id, []
    )

    linked = await professionals.list_service_ids(db, scene.business_id)
    assert linked[scene.professional_id] == [scene.service_id]


async def test_replacing_working_hours_needs_the_business(
    db: AsyncSession, scene: Scene
) -> None:
    await working_hours.replace(db, scene.other_business_id, scene.professional_id, [])

    assert await working_hours.list_for_professional(
        db, scene.business_id, scene.professional_id
    )


async def try_to_lock(engine: AsyncEngine, professional_id: UUID) -> None:
    """NOWAIT fails right away if another transaction holds the row."""
    async with async_sessionmaker(engine)() as other_session:
        await other_session.execute(
            select(Professional.id)
            .where(Professional.id == professional_id)
            .with_for_update(nowait=True)
        )


async def test_locking_many_professionals_stays_in_the_business(
    db: AsyncSession, engine: AsyncEngine, scene: Scene
) -> None:
    await professionals.lock_many(db, scene.other_business_id, [scene.professional_id])
    await try_to_lock(engine, scene.professional_id)
    await db.rollback()

    await professionals.lock_many(db, scene.business_id, [scene.professional_id])
    with raises(DBAPIError):
        await try_to_lock(engine, scene.professional_id)


async def test_locking_all_professionals_stays_in_the_business(
    db: AsyncSession, engine: AsyncEngine, scene: Scene
) -> None:
    await professionals.lock_all(db, scene.other_business_id)
    await try_to_lock(engine, scene.professional_id)
    await db.rollback()

    await professionals.lock_all(db, scene.business_id)
    with raises(DBAPIError):
        await try_to_lock(engine, scene.professional_id)
