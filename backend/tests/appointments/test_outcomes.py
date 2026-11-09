"""UC18: the outcome of the appointment (RN15, D32)."""

from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppointmentStatus, EmailOutbox
from tests.appointments.helpers import (
    AGENDA_FIELDS,
    act,
    create_manual,
    manual_body,
    post_manual,
    staff_reschedule,
)
from tests.auth.helpers import Clock
from tests.configuration.helpers import Member, make_appointment
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    get_appointment,
    get_availability,
    local_day,
    local_iso,
    offered,
)

pytestmark = mark.anyio

OUTCOMES = [("complete", "completed"), ("no-show", "no_show")]


async def count_all_emails(db: AsyncSession) -> int | None:
    return await db.scalar(select(func.count()).select_from(EmailOutbox))


@mark.parametrize(("action", "status"), OUTCOMES)
async def test_ct34_the_outcome_is_refused_before_the_start(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    action: str,
    status: str,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    clock.now = monday_10 - timedelta(seconds=1)

    response = await act(client, owner_token, created["id"], action)

    assert response.status_code == 409
    assert response.json()["code"] == "INVALID_STATUS_TRANSITION"
    stored = await get_appointment(db, created["id"])
    assert stored.status is AppointmentStatus.CONFIRMED


@mark.parametrize(("action", "status"), OUTCOMES)
async def test_ct34_the_outcome_is_accepted_at_the_exact_start(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    action: str,
    status: str,
) -> None:
    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10,
        email=CUSTOMER_EMAIL,
    )
    emails_before = await count_all_emails(db)
    clock.now = monday_10

    response = await act(client, owner_token, created["id"], action)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == AGENDA_FIELDS
    assert body["status"] == status
    assert body["cancelled_at"] is None
    assert (await get_appointment(db, created["id"])).status.value == status
    # D32: no e-mail for the outcome.
    assert await count_all_emails(db) == emails_before


@mark.parametrize(
    "final",
    [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
    ],
)
async def test_ct34_a_final_status_does_not_change(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    final: AppointmentStatus,
) -> None:
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], monday_10, status=final
    )
    clock.now = monday_10 + timedelta(hours=1)
    appointment_id = str(appointment.id)

    responses = [
        await act(client, owner_token, appointment_id, "complete"),
        await act(client, owner_token, appointment_id, "no-show"),
        await act(client, owner_token, appointment_id, "cancel"),
        await staff_reschedule(
            client, owner_token, appointment_id, monday_10 + timedelta(hours=2)
        ),
    ]

    for response in responses:
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "INVALID_STATUS_TRANSITION"
    assert (await get_appointment(db, appointment_id)).status is final


async def test_ct34_long_after_the_start_the_outcome_is_still_accepted(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    clock.now = monday_10 + timedelta(days=60)

    response = await act(client, owner_token, created["id"], "complete")

    assert response.status_code == 200, response.text


@mark.parametrize(("action", "status"), OUTCOMES)
async def test_rn15_the_outcome_still_occupies_the_time(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    action: str,
    status: str,
) -> None:
    later = monday_10 + timedelta(hours=1)
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], later
    )
    clock.now = later
    assert (await act(client, owner_token, created["id"], action)).status_code == 200
    # Back to the past, so the public side offers that day again.
    clock.now = monday_10 - timedelta(days=1)

    slots = offered(
        await get_availability(
            client,
            service["id"],
            local_day(monday_10),
            professional_id=pro.professional_id,
        )
    )

    assert local_iso(monday_10) in slots
    assert local_iso(later) not in slots
    # The team's manual booking is refused there as well.
    refused = await post_manual(
        client, owner_token, manual_body(pro.professional_id, service["id"], later)
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "SLOT_UNAVAILABLE"
