"""UC17: cancelling and rescheduling by the team (RN20, D30, D31)."""

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import AppointmentStatus, Service
from tests.appointments.helpers import (
    AGENDA,
    AGENDA_FIELDS,
    CANCELLATION,
    RESCHEDULE,
    act,
    create_manual,
    staff_reschedule,
)
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    TUESDAY,
    Member,
    create_service,
    iso_utc,
    make_appointment,
    next_local,
)
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    CUSTOMER_NAME,
    book,
    cancel_link,
    count_emails,
    emails_with,
    get_appointment,
    get_link,
    local_iso,
    reschedule_link,
)

pytestmark = mark.anyio

DEFAULT_DEADLINE = timedelta(minutes=120)


async def assert_unchanged(
    db: AsyncSession, appointment_id: str, starts_at: datetime, professional_id: str
) -> None:
    """D30: every refusal keeps the original as it was."""
    appointment = await get_appointment(db, appointment_id)
    assert appointment.status is AppointmentStatus.CONFIRMED
    assert appointment.starts_at == starts_at
    assert appointment.ends_at == starts_at + timedelta(minutes=30)
    assert appointment.blocked_until == starts_at + timedelta(minutes=30)
    assert str(appointment.professional_id) == professional_id
    assert await count_emails(db, RESCHEDULE) == 0


async def test_d30_rescheduling_keeps_the_row_and_answers_the_agenda_item(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    new_time = monday_10 + timedelta(hours=2, minutes=7)

    response = await staff_reschedule(client, owner_token, created["id"], new_time)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == AGENDA_FIELDS | {"email_status"}
    assert body["id"] == created["id"]
    assert body["status"] == "confirmed"
    assert body["starts_at"] == iso_utc(new_time)
    assert body["ends_at"] == iso_utc(new_time + timedelta(minutes=30))
    assert body["professional_id"] == pro.professional_id
    assert body["email_status"] == "none"
    appointment = await get_appointment(db, created["id"])
    assert appointment.starts_at == new_time


async def test_ct53_rescheduling_over_the_own_time_keeps_the_same_link(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    appointment_id = booked.json()["id"]
    hash_before = (await get_appointment(db, appointment_id)).access_token_hash
    new_time = monday_10 + timedelta(minutes=15)

    response = await staff_reschedule(client, owner_token, appointment_id, new_time)

    assert response.status_code == 200, response.text
    appointment = await get_appointment(db, appointment_id)
    assert appointment.starts_at == new_time
    assert appointment.access_token_hash == hash_before
    link = await get_link(client, token)
    assert link.status_code == 200
    assert link.json()["starts_at"] == local_iso(new_time)


async def test_d30_rescheduling_keeps_the_copied_values(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """RN11: the service changed, but the block is the one booked."""
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    await db.execute(
        update(Service).values(
            duration_minutes=120, preparation_minutes=30, price_cents=9900
        )
    )
    await db.commit()
    # Fits only with the copied 30 minutes, until 18:00.
    new_time = monday_10 + timedelta(hours=7, minutes=30)

    response = await staff_reschedule(client, owner_token, created["id"], new_time)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ends_at"] == iso_utc(new_time + timedelta(minutes=30))
    assert body["blocked_until"] == body["ends_at"]
    assert body["duration_minutes"] == 30
    assert body["preparation_minutes"] == 0
    assert body["price_cents"] == 5000


async def test_d30_the_owner_moves_the_appointment_to_a_colleague(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )

    moved = await staff_reschedule(
        client,
        owner_token,
        created["id"],
        monday_10,
        professional_id=colleague.professional_id,
    )
    kept = await client.post(
        f"{AGENDA}/{created['id']}/reschedule",
        json={
            "starts_at": iso_utc(monday_10 + timedelta(hours=1)),
            "professional_id": None,
        },
        headers=bearer(owner_token),
    )

    assert moved.status_code == 200, moved.text
    assert moved.json()["professional_id"] == colleague.professional_id
    # Absent or null keeps the current professional, without RN10.
    assert kept.status_code == 200, kept.text
    assert kept.json()["professional_id"] == colleague.professional_id


async def test_ct33_the_team_changes_after_the_customer_deadline(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    first, first_token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    second_start = monday_10 + timedelta(hours=1)
    second, second_token = await book(
        client,
        service["id"],
        second_start,
        professional_id=pro.professional_id,
        email="segunda@example.com",
    )
    # Past the deadline of both: 09:01, with 2 hours of deadline.
    clock.now = second_start - DEFAULT_DEADLINE + timedelta(minutes=1)
    assert (await cancel_link(client, first_token)).json()["code"] == (
        "CHANGE_DEADLINE_PASSED"
    )
    late_time = second_start + timedelta(hours=3)
    refused = await reschedule_link(client, second_token, late_time)
    assert refused.json()["code"] == "CHANGE_DEADLINE_PASSED"

    rescheduled = await staff_reschedule(
        client, owner_token, second.json()["id"], late_time
    )
    cancelled = await act(client, owner_token, first.json()["id"], "cancel")

    assert rescheduled.status_code == 200, rescheduled.text
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancelled_at"] == iso_utc(clock.now)


async def test_ct33_the_team_cancels_even_after_the_start(
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
    clock.now = monday_10 + timedelta(hours=1)

    response = await act(client, owner_token, created["id"], "cancel")

    assert response.status_code == 200, response.text
    assert response.json()["email_status"] == "none"


async def test_d31_cancelling_twice_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10,
        email=CUSTOMER_EMAIL,
    )
    first = await act(client, owner_token, created["id"], "cancel")

    second = await act(client, owner_token, created["id"], "cancel")

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["code"] == "INVALID_STATUS_TRANSITION"
    assert await count_emails(db, CANCELLATION) == 1


@mark.parametrize(
    "status",
    [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
    ],
)
async def test_d30_only_confirmed_appointments_are_rescheduled(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    status: AppointmentStatus,
) -> None:
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], monday_10, status=status
    )

    rescheduled = await staff_reschedule(
        client, owner_token, str(appointment.id), monday_10 + timedelta(hours=2)
    )
    cancelled = await act(client, owner_token, str(appointment.id), "cancel")

    for response in (rescheduled, cancelled):
        assert response.status_code == 409
        assert response.json()["code"] == "INVALID_STATUS_TRANSITION"
    stored = await get_appointment(db, str(appointment.id))
    assert stored.status is status
    assert stored.starts_at == monday_10


async def test_ct35_rescheduling_in_the_past_or_outside_hours_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=3),
    )
    original = monday_10 + timedelta(hours=3)
    clock.now = monday_10 + timedelta(minutes=1)

    for new_time in (
        monday_10,
        monday_10 + timedelta(hours=7, minutes=45),
        next_local(monday_10, TUESDAY, "10:00"),
    ):
        response = await staff_reschedule(client, owner_token, created["id"], new_time)
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "SLOT_UNAVAILABLE"
        await assert_unchanged(db, created["id"], original, pro.professional_id)


async def test_d30_rescheduling_over_another_appointment_or_block_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    await make_appointment(
        db, pro.professional_id, service["id"], monday_10 + timedelta(hours=2)
    )
    block = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": iso_utc(monday_10 + timedelta(hours=4)),
            "ends_at": iso_utc(monday_10 + timedelta(hours=5)),
            "reason": "Reunião",
        },
        headers=bearer(owner_token),
    )
    assert block.status_code == 201, block.text

    for new_time in (
        monday_10 + timedelta(hours=2, minutes=15),
        monday_10 + timedelta(hours=3, minutes=45),
    ):
        response = await staff_reschedule(client, owner_token, created["id"], new_time)
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "SLOT_UNAVAILABLE"
        await assert_unchanged(db, created["id"], monday_10, pro.professional_id)


async def test_d30_the_body_has_the_rules_of_the_manual_booking(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    # The colleague stops serving the service.
    other_service = await create_service(client, owner_token, name="Barba")
    linked = await client.put(
        f"{API}/professionals/{colleague.professional_id}/services",
        json={"service_ids": [other_service["id"]]},
        headers=bearer(owner_token),
    )
    assert linked.status_code == 200, linked.text
    later = monday_10 + timedelta(hours=2)
    path = f"{AGENDA}/{created['id']}/reschedule"

    cases = [
        ({"starts_at": iso_utc(later + timedelta(seconds=1))}, 422),
        ({"starts_at": iso_utc(later), "notes": "texto"}, 422),
        ({}, 422),
        (
            {"starts_at": iso_utc(later), "professional_id": colleague.professional_id},
            422,
        ),
        ({"starts_at": iso_utc(later), "professional_id": str(uuid4())}, 404),
        (
            {
                "starts_at": iso_utc(later),
                "professional_id": other_business["professional_id"],
            },
            404,
        ),
    ]
    for body, status in cases:
        response = await client.post(path, json=body, headers=bearer(owner_token))
        assert response.status_code == status, (body, response.text)
        await assert_unchanged(db, created["id"], monday_10, pro.professional_id)


async def test_d30_an_inactive_service_cannot_be_rescheduled(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    await db.execute(update(Service).values(is_active=False))
    await db.commit()

    rescheduled = await staff_reschedule(
        client, owner_token, created["id"], monday_10 + timedelta(hours=2)
    )

    assert rescheduled.status_code == 422
    await assert_unchanged(db, created["id"], monday_10, pro.professional_id)
    cancelled = await act(client, owner_token, created["id"], "cancel")
    assert cancelled.status_code == 200


async def test_ct56_the_reschedule_email_has_no_customer_name_and_no_link(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    new_time = monday_10 + timedelta(hours=2)

    response = await staff_reschedule(
        client, owner_token, booked.json()["id"], new_time
    )

    assert response.json()["email_status"] == "queued"
    [message] = await emails_with(db, RESCHEDULE)
    assert message.to_email == CUSTOMER_EMAIL
    assert message.payload == {
        "business_name": "Barbearia",
        "service_name": "Corte",
        "professional_name": "Profissional",
        "starts_at": local_iso(new_time),
        "link_still_valid": True,
    }
    assert CUSTOMER_NAME not in str(message.payload)
    assert token not in str(message.payload)


async def test_ct56_the_cancellation_email_has_no_customer_name_and_no_link(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await act(client, owner_token, booked.json()["id"], "cancel")

    assert response.json()["email_status"] == "queued"
    [message] = await emails_with(db, CANCELLATION)
    assert message.payload == {
        "business_name": "Barbearia",
        "service_name": "Corte",
        "professional_name": "Profissional",
        "starts_at": local_iso(monday_10),
    }
    assert CUSTOMER_NAME not in str(message.payload)
    assert token not in str(message.payload)


async def test_ct56_above_the_email_limit_the_change_stays_without_email(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    first, _ = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    second, _ = await book(
        client,
        service["id"],
        monday_10 + timedelta(hours=1),
        professional_id=pro.professional_id,
    )
    # The two bookings spent the e-mails of the day for this recipient.
    settings.email_recipient_daily_cap = 2
    new_time = monday_10 + timedelta(hours=3)

    rescheduled = await staff_reschedule(
        client, owner_token, first.json()["id"], new_time
    )
    cancelled = await act(client, owner_token, second.json()["id"], "cancel")

    assert rescheduled.status_code == 200
    assert rescheduled.json()["email_status"] == "skipped"
    assert cancelled.status_code == 200
    assert cancelled.json()["email_status"] == "skipped"
    assert (await get_appointment(db, first.json()["id"])).starts_at == new_time
    assert (await get_appointment(db, second.json()["id"])).status is (
        AppointmentStatus.CANCELLED
    )
    assert await count_emails(db, RESCHEDULE) == 0
    assert await count_emails(db, CANCELLATION) == 0


async def test_d31_without_email_nothing_is_queued_nor_spent(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.email_daily_cap = 0
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )

    rescheduled = await staff_reschedule(
        client, owner_token, created["id"], monday_10 + timedelta(hours=1)
    )
    cancelled = await act(client, owner_token, created["id"], "cancel")

    assert rescheduled.json()["email_status"] == "none"
    assert cancelled.json()["email_status"] == "none"
    assert await count_emails(db, RESCHEDULE) == 0
    assert await count_emails(db, CANCELLATION) == 0
