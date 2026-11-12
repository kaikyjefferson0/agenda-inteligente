"""RN14 for the team: the locks and the exclusion constraint (D28, D30)."""

import asyncio
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from httpx import AsyncClient
from pytest import MonkeyPatch, mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, AppointmentStatus
from app.services import staff_appointments
from tests.appointments.helpers import (
    CANCELLATION,
    CONFIRMATION,
    RESCHEDULE,
    act,
    create_manual,
    manual_body,
    post_manual,
    staff_reschedule,
)
from tests.configuration.helpers import Member, make_appointment
from tests.public.helpers import (
    book,
    booking_body,
    cancel_link,
    count_appointments,
    count_emails,
    get_appointment,
    post_booking,
    reschedule_link,
)
from tests.public.test_concurrency import change_while_waiting_for_the_locks

pytestmark = mark.anyio


async def test_manual_and_public_bookings_of_the_same_time_leave_one(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    manual, public = await asyncio.gather(
        post_manual(
            client,
            owner_token,
            manual_body(
                pro.professional_id,
                service["id"],
                monday_10,
                email="equipe@example.com",
            ),
        ),
        post_booking(
            client,
            booking_body(service["id"], monday_10, professional_id=pro.professional_id),
        ),
    )

    statuses = sorted([manual.status_code, public.status_code])
    assert statuses in ([201, 409], [409, 201])
    refused = manual if manual.status_code == 409 else public
    assert refused.json()["code"] == "SLOT_UNAVAILABLE"
    assert await count_appointments(db) == 1
    assert await count_emails(db, CONFIRMATION) == 1


async def test_two_manual_bookings_of_the_same_time_leave_one(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    responses = await asyncio.gather(
        post_manual(
            client,
            owner_token,
            manual_body(pro.professional_id, service["id"], monday_10),
        ),
        post_manual(
            client,
            pro.token,
            manual_body(
                pro.professional_id, service["id"], monday_10 + timedelta(minutes=10)
            ),
        ),
    )

    assert sorted(item.status_code for item in responses) == [201, 409]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["reason"] == "appointment_conflict"
    assert await count_appointments(db) == 1


async def test_staff_reschedule_and_link_cancel_at_the_same_time_stay_coherent(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """Whatever the order, no deadlock and no 500, and one e-mail per change."""
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    appointment_id = booked.json()["id"]
    target = monday_10 + timedelta(hours=3)

    rescheduled, cancelled = await asyncio.gather(
        staff_reschedule(client, owner_token, appointment_id, target),
        cancel_link(client, token),
    )

    # The cancellation always wins, before or after the reschedule.
    assert cancelled.status_code == 200, cancelled.text
    appointment = await get_appointment(db, appointment_id)
    assert appointment.status is AppointmentStatus.CANCELLED
    assert await count_emails(db, CANCELLATION) == 1
    if rescheduled.status_code == 200:
        assert appointment.starts_at == target
        assert await count_emails(db, RESCHEDULE) == 1
    else:
        assert rescheduled.status_code == 409, rescheduled.text
        assert rescheduled.json()["code"] == "INVALID_STATUS_TRANSITION"
        assert appointment.starts_at == monday_10
        assert await count_emails(db, RESCHEDULE) == 0


async def test_two_staff_reschedules_to_the_same_time_leave_one(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    first = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    second_start = monday_10 + timedelta(hours=1)
    second = await create_manual(
        client, owner_token, pro.professional_id, service["id"], second_start
    )
    target = monday_10 + timedelta(hours=3)

    responses = await asyncio.gather(
        staff_reschedule(client, owner_token, first["id"], target),
        staff_reschedule(client, pro.token, second["id"], target),
    )

    assert sorted(item.status_code for item in responses) == [200, 409]
    rows = [
        await get_appointment(db, first["id"]),
        await get_appointment(db, second["id"]),
    ]
    assert [row.starts_at == target for row in rows].count(True) == 1
    originals = {first["id"]: monday_10, second["id"]: second_start}
    kept = next(row for row in rows if row.starts_at != target)
    assert kept.starts_at == originals[str(kept.id)]


async def test_two_outcomes_at_the_same_time_record_one(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], monday_10 - timedelta(days=14)
    )

    responses = await asyncio.gather(
        act(client, owner_token, str(appointment.id), "complete"),
        act(client, pro.token, str(appointment.id), "no-show"),
    )

    assert sorted(item.status_code for item in responses) == [200, 409]
    winner = next(item for item in responses if item.status_code == 200)
    stored = await get_appointment(db, str(appointment.id))
    assert stored.status.value == winner.json()["status"]


async def test_the_exclusion_constraint_is_the_last_defense(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """Even if the check in the application failed, the database answers 409."""
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=2),
    )
    monkeypatch.setattr(staff_appointments, "busy_refusal", lambda *_, **__: None)

    booked = await post_manual(
        client,
        owner_token,
        manual_body(
            pro.professional_id,
            service["id"],
            monday_10,
            email="equipe@example.com",
        ),
    )
    rescheduled = await staff_reschedule(client, owner_token, created["id"], monday_10)

    for response in (booked, rescheduled):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "SLOT_UNAVAILABLE"
        # D77: the constraint is the one between appointments.
        assert response.json()["reason"] == "appointment_conflict"
    assert await count_appointments(db) == 2
    assert await count_emails(db, CONFIRMATION) == 0
    # The rollback keeps the original time.
    stored = await get_appointment(db, created["id"])
    assert stored.starts_at == monday_10 + timedelta(hours=2)


@mark.parametrize(
    ("viewer", "status", "code"),
    [("owner", 409, "SLOT_UNAVAILABLE"), ("pro", 403, "FORBIDDEN")],
)
async def test_d30_moved_to_an_unlocked_professional_while_waiting_for_the_locks(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
    viewer: str,
    status: int,
    code: str,
) -> None:
    """Without `professional_id`, only the current professional is locked.

    If another change moves the appointment to a colleague before the lock,
    the time on the colleague was never checked under a lock, so it is refused.
    For a Professional, the appointment now belongs to a colleague (D27).
    """
    created = await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )
    change_while_waiting_for_the_locks(
        monkeypatch,
        db,
        update(Appointment)
        .where(Appointment.id == UUID(created["id"]))
        .values(professional_id=UUID(colleague.professional_id)),
    )
    token = owner_token if viewer == "owner" else pro.token

    response = await staff_reschedule(
        client, token, created["id"], monday_10 + timedelta(hours=2)
    )

    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    if status == 409:  # D77: the other change, not the time, is the reason.
        assert response.json()["reason"] == "changed_meanwhile"
        assert response.json()["detail"] == (
            "O agendamento foi alterado por outra pessoa durante a remarcação. "
            "Atualize a agenda e tente de novo."
        )
    # The row is the one the other change left, with the original time.
    stored = await get_appointment(db, created["id"])
    assert str(stored.professional_id) == colleague.professional_id
    assert stored.starts_at == monday_10
    assert stored.status is AppointmentStatus.CONFIRMED
    assert await count_emails(db, RESCHEDULE) == 0


async def test_staff_and_link_reschedules_to_different_professionals_stay_coherent(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    """The customer moves it to a colleague while the team keeps the professional.

    Whatever the order, no deadlock and no 500: the team either sees the move
    before reading, and reschedules on the colleague, or reads it too late and
    answers 409, leaving the customer's change as it was.
    """
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    appointment_id = booked.json()["id"]
    customer_time = monday_10 + timedelta(hours=4)
    staff_time = monday_10 + timedelta(hours=5)

    by_customer, by_staff = await asyncio.gather(
        reschedule_link(
            client,
            token,
            customer_time,
            professional_id=colleague.professional_id,
        ),
        staff_reschedule(client, owner_token, appointment_id, staff_time),
    )

    assert by_customer.status_code == 200, by_customer.text
    assert by_staff.status_code in (200, 409), by_staff.text
    stored = await get_appointment(db, appointment_id)
    assert str(stored.professional_id) == colleague.professional_id
    assert stored.ends_at == stored.starts_at + timedelta(minutes=30)
    assert stored.blocked_until == stored.ends_at
    if by_staff.status_code == 409:
        assert by_staff.json()["code"] == "SLOT_UNAVAILABLE"
        assert stored.starts_at == customer_time
        assert await count_emails(db, RESCHEDULE) == 1
    else:
        # Both applied, in some order; the last one decides the time.
        assert stored.starts_at in (customer_time, staff_time)
        assert await count_emails(db, RESCHEDULE) == 2
