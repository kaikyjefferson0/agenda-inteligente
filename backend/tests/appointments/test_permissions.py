"""D27: Owner in any agenda, Professional in the own one, and 404 across businesses."""

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppointmentStatus
from tests.appointments.helpers import (
    AGENDA,
    act,
    create_manual,
    manual_body,
    post_manual,
    staff_reschedule,
)
from tests.auth.helpers import Clock
from tests.configuration.helpers import Member
from tests.public.helpers import count_appointments, get_appointment

pytestmark = mark.anyio

ACTIONS = ["cancel", "complete", "no-show"]


def assert_code(response: Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["code"] == code


async def test_ct55_the_professional_does_not_book_in_the_agenda_of_a_colleague(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    response = await post_manual(
        client,
        pro.token,
        manual_body(colleague.professional_id, service["id"], monday_10),
    )

    assert_code(response, 403, "FORBIDDEN")
    assert await count_appointments(db) == 0


async def test_ct55_the_professional_does_not_change_the_agenda_of_a_colleague(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    theirs = await create_manual(
        client, owner_token, colleague.professional_id, service["id"], monday_10
    )
    mine = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=1),
    )
    clock.now = monday_10 + timedelta(hours=2)
    later = monday_10 + timedelta(hours=3)

    responses = [
        await staff_reschedule(client, pro.token, theirs["id"], later),
        # Moving the own appointment to a colleague is also refused.
        await staff_reschedule(
            client,
            pro.token,
            mine["id"],
            later,
            professional_id=colleague.professional_id,
        ),
        *[await act(client, pro.token, theirs["id"], action) for action in ACTIONS],
    ]

    for response in responses:
        assert_code(response, 403, "FORBIDDEN")
    for created in (theirs, mine):
        stored = await get_appointment(db, created["id"])
        assert stored.status is AppointmentStatus.CONFIRMED
        assert stored.starts_at != later


async def test_d27_the_professional_manages_the_own_agenda(
    client: AsyncClient,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    first = await create_manual(
        client, pro.token, pro.professional_id, service["id"], monday_10
    )
    second = await create_manual(
        client,
        pro.token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=1),
    )

    rescheduled = await staff_reschedule(
        client, pro.token, first["id"], monday_10 + timedelta(hours=2)
    )
    cancelled = await act(client, pro.token, second["id"], "cancel")
    clock.now = monday_10 + timedelta(hours=2)
    completed = await act(client, pro.token, first["id"], "complete")

    assert rescheduled.status_code == 200, rescheduled.text
    assert cancelled.status_code == 200, cancelled.text
    assert completed.status_code == 200, completed.text


async def test_ct55_resources_of_another_business_are_not_found(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    foreign = await create_manual(
        client,
        other_business["token"],
        other_business["professional_id"],
        other_business["service_id"],
        monday_10,
    )
    missing = await act(client, owner_token, str(uuid4()), "cancel")
    clock.now = monday_10 + timedelta(hours=1)

    responses = [
        await staff_reschedule(
            client, owner_token, foreign["id"], monday_10 + timedelta(hours=2)
        ),
        *[await act(client, owner_token, foreign["id"], action) for action in ACTIONS],
        await post_manual(
            client,
            owner_token,
            manual_body(other_business["professional_id"], service["id"], monday_10),
        ),
        await post_manual(
            client,
            owner_token,
            manual_body(pro.professional_id, other_business["service_id"], monday_10),
        ),
    ]

    # CT19: the same answer as for something that does not exist.
    for response in responses:
        assert response.status_code == 404, response.text
        assert response.json() == missing.json()
    stored = await get_appointment(db, foreign["id"])
    assert stored.status is AppointmentStatus.CONFIRMED
    assert stored.starts_at == monday_10
    assert await count_appointments(db) == 1


async def test_every_route_requires_a_session(
    client: AsyncClient, service: dict[str, Any], pro: Member, monday_10: datetime
) -> None:
    some_id = str(uuid4())
    responses = [
        await client.post(
            AGENDA, json=manual_body(pro.professional_id, service["id"], monday_10)
        ),
        await client.post(
            f"{AGENDA}/{some_id}/reschedule",
            json={"starts_at": "2030-03-04T13:00:00Z"},
        ),
        *[await client.post(f"{AGENDA}/{some_id}/{action}") for action in ACTIONS],
    ]

    for response in responses:
        assert_code(response, 401, "NOT_AUTHENTICATED")
