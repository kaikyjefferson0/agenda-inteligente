"""D77: the reason of the team's 409, and the public routes without it."""

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response
from pytest import FixtureRequest, fixture, mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import PROBLEMS, SLOT_REFUSAL_DETAILS
from app.domain.errors import ErrorCode, SlotRefusal
from app.models import Service
from tests.appointments.helpers import manual_body, post_manual, staff_reschedule
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    MONDAY,
    Member,
    iso_utc,
    make_appointment,
    next_local,
)
from tests.public.helpers import (
    book,
    booking_body,
    get_appointment,
    post_booking,
    reschedule_link,
)

pytestmark = mark.anyio

Attempt = Callable[[datetime], Awaitable[Response]]
GENERIC_DETAIL = PROBLEMS[ErrorCode.SLOT_UNAVAILABLE].detail


async def block(
    client: AsyncClient,
    token: str,
    professional_id: str,
    starts: datetime,
    end: datetime,
) -> None:
    response = await client.post(
        f"{API}/professionals/{professional_id}/time-blocks",
        json={"starts_at": iso_utc(starts), "ends_at": iso_utc(end), "reason": "Folga"},
        headers=bearer(token),
    )
    assert response.status_code == 201, response.text


def assert_reason(response: Response, reason: SlotRefusal) -> None:
    assert response.status_code == 409, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    problem: dict[str, Any] = response.json()
    assert problem["code"] == "SLOT_UNAVAILABLE"
    assert problem["reason"] == reason.value
    assert problem["detail"] == SLOT_REFUSAL_DETAILS[reason]
    assert problem["detail"] != GENERIC_DETAIL


@fixture(params=["create", "reschedule"])
async def attempt(
    request: FixtureRequest,
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> Attempt:
    """The same time through `POST /appointments` or through the reschedule.

    The rescheduled appointment sits at 15:00, away from every tested time,
    and must keep it after each refusal.
    """
    if request.param == "create":

        async def create(starts_at: datetime) -> Response:
            return await post_manual(
                client,
                owner_token,
                manual_body(pro.professional_id, service["id"], starts_at),
            )

        return create

    original = monday_10 + timedelta(hours=5)
    existing = await make_appointment(db, pro.professional_id, service["id"], original)

    async def reschedule(starts_at: datetime) -> Response:
        response = await staff_reschedule(
            client, owner_token, str(existing.id), starts_at
        )
        if response.status_code == 409:
            stored = await get_appointment(db, str(existing.id))
            assert stored.starts_at == original
        return response

    return reschedule


def test_every_reason_has_its_own_detail() -> None:
    assert set(SLOT_REFUSAL_DETAILS) == set(SlotRefusal)
    assert len(set(SLOT_REFUSAL_DETAILS.values())) == len(SlotRefusal)
    assert GENERIC_DETAIL not in SLOT_REFUSAL_DETAILS.values()


# The reasons about the time, on both routes. `changed_meanwhile` is in
# test_concurrency.py, since it needs a change while waiting for the locks.


async def test_in_past(attempt: Attempt, clock: Clock, monday_10: datetime) -> None:
    clock.now = monday_10 + timedelta(minutes=1)
    assert_reason(await attempt(monday_10), SlotRefusal.IN_PAST)


async def test_outside_working_hours(attempt: Attempt, monday_10: datetime) -> None:
    """RN03: before opening, past closing, and the preparation past closing."""
    assert_reason(
        await attempt(monday_10 - timedelta(hours=2)), SlotRefusal.OUTSIDE_WORKING_HOURS
    )
    assert_reason(
        await attempt(monday_10 + timedelta(hours=7, minutes=45)),
        SlotRefusal.OUTSIDE_WORKING_HOURS,
    )


async def test_preparation_outside_working_hours(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """17:30 + 30 min fits until 18:00, but not with 10 min of preparation."""
    await db.execute(update(Service).values(preparation_minutes=10))
    await db.commit()

    response = await post_manual(
        client,
        owner_token,
        manual_body(
            pro.professional_id,
            service["id"],
            monday_10 + timedelta(hours=7, minutes=30),
        ),
    )

    assert_reason(response, SlotRefusal.OUTSIDE_WORKING_HOURS)


async def test_blocked(
    attempt: Attempt,
    client: AsyncClient,
    owner_token: str,
    pro: Member,
    monday_10: datetime,
) -> None:
    await block(
        client,
        owner_token,
        pro.professional_id,
        monday_10 + timedelta(hours=1),
        monday_10 + timedelta(hours=2),
    )
    assert_reason(await attempt(monday_10 + timedelta(minutes=45)), SlotRefusal.BLOCKED)


async def test_appointment_conflict(
    attempt: Attempt,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    assert_reason(
        await attempt(monday_10 + timedelta(minutes=15)),
        SlotRefusal.APPOINTMENT_CONFLICT,
    )


async def test_conflict_on_the_new_professional_of_a_reschedule(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    """The reason is about the professional who would receive the appointment."""
    existing = await make_appointment(db, pro.professional_id, service["id"], monday_10)
    await make_appointment(
        db, colleague.professional_id, service["id"], monday_10 + timedelta(hours=2)
    )

    response = await staff_reschedule(
        client,
        owner_token,
        str(existing.id),
        monday_10 + timedelta(hours=2),
        professional_id=colleague.professional_id,
    )

    assert_reason(response, SlotRefusal.APPOINTMENT_CONFLICT)


# The order when more than one applies (D77).


async def test_the_past_comes_before_the_working_hours(
    attempt: Attempt, clock: Clock, monday_10: datetime
) -> None:
    clock.now = monday_10
    assert_reason(await attempt(monday_10 - timedelta(hours=2)), SlotRefusal.IN_PAST)


async def test_the_working_hours_come_before_a_block(
    attempt: Attempt,
    client: AsyncClient,
    owner_token: str,
    pro: Member,
    monday_10: datetime,
) -> None:
    """17:45 crosses the closing and also falls in a block from 17:30."""
    await block(
        client,
        owner_token,
        pro.professional_id,
        monday_10 + timedelta(hours=7, minutes=30),
        monday_10 + timedelta(hours=9),
    )
    assert_reason(
        await attempt(monday_10 + timedelta(hours=7, minutes=45)),
        SlotRefusal.OUTSIDE_WORKING_HOURS,
    )


async def test_a_block_comes_before_an_appointment(
    attempt: Attempt,
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """The block goes first through the API; the appointment straight to the
    database, since the API would refuse a block over it (RN21)."""
    await block(
        client,
        owner_token,
        pro.professional_id,
        monday_10,
        monday_10 + timedelta(minutes=30),
    )
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    assert_reason(await attempt(monday_10), SlotRefusal.BLOCKED)


# The public routes keep the generic 409, without the reason.


async def test_the_public_booking_never_tells_the_reason(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    clock: Clock,
) -> None:
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    await block(
        client,
        owner_token,
        pro.professional_id,
        monday_10 + timedelta(hours=1),
        monday_10 + timedelta(hours=2),
    )

    for starts_at in (
        monday_10,  # occupied
        monday_10 + timedelta(hours=1),  # blocked
        next_local(clock.now, MONDAY, "19:00"),  # outside the working hours
    ):
        response = await post_booking(
            client,
            booking_body(service["id"], starts_at, professional_id=pro.professional_id),
        )
        assert response.status_code == 409, response.text
        problem = response.json()
        assert problem["code"] == "SLOT_UNAVAILABLE"
        assert "reason" not in problem
        assert problem["detail"] == GENERIC_DETAIL


async def test_the_customer_link_never_tells_the_reason(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    await make_appointment(
        db, pro.professional_id, service["id"], monday_10 + timedelta(hours=1)
    )

    response = await reschedule_link(
        client,
        token,
        monday_10 + timedelta(hours=1),
        professional_id=pro.professional_id,
    )

    assert response.status_code == 409, response.text
    problem = response.json()
    assert problem["code"] == "SLOT_UNAVAILABLE"
    assert "reason" not in problem
    assert problem["detail"] == GENERIC_DETAIL


async def test_a_block_past_the_end_of_the_calendar_is_outside_the_hours(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
) -> None:
    """No working hours reach a block that would end after year 9999."""
    response = await post_manual(
        client,
        owner_token,
        manual_body(pro.professional_id, service["id"], "9999-12-31T23:45:00Z"),
    )

    assert_reason(response, SlotRefusal.OUTSIDE_WORKING_HOURS)
