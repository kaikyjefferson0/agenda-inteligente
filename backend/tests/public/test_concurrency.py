import asyncio
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from pytest import MonkeyPatch, mark
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Professional, Service, TimeBlock
from app.repositories import professionals
from app.services import public_booking
from tests.auth.helpers import API, bearer
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

pytestmark = mark.anyio


async def test_ct06_two_simultaneous_bookings_of_the_same_time(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    responses = await asyncio.gather(
        post_booking(
            client,
            booking_body(
                service["id"],
                monday_10,
                professional_id=pro.professional_id,
                email="primeira@example.com",
            ),
        ),
        post_booking(
            client,
            booking_body(
                service["id"],
                monday_10,
                professional_id=pro.professional_id,
                email="segunda@example.com",
            ),
        ),
    )

    assert sorted(item.status_code for item in responses) == [201, 409]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["code"] == "SLOT_UNAVAILABLE"
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1


async def test_ct06_overlapping_times_also_end_with_one_winner(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    responses = await asyncio.gather(
        post_booking(client, booking_body(service["id"], monday_10)),
        post_booking(
            client,
            booking_body(
                service["id"],
                monday_10 + timedelta(minutes=15),
                email="segunda@example.com",
            ),
        ),
    )

    assert sorted(item.status_code for item in responses) == [201, 409]
    assert await count_appointments(db) == 1


async def test_no_preference_serves_two_simultaneous_customers_with_two_professionals(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    responses = await asyncio.gather(
        post_booking(
            client,
            booking_body(service["id"], monday_10, email="primeira@example.com"),
        ),
        post_booking(
            client,
            booking_body(service["id"], monday_10, email="segunda@example.com"),
        ),
    )
    third = await post_booking(
        client, booking_body(service["id"], monday_10, email="terceira@example.com")
    )

    assert [item.status_code for item in responses] == [201, 201]
    assigned = {
        str((await get_appointment(db, item.json()["id"])).professional_id)
        for item in responses
    }
    assert assigned == {pro.professional_id, colleague.professional_id}
    assert third.status_code == 409


async def test_simultaneous_bookings_in_opposite_orders_do_not_deadlock(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    """No preference locks both, and the others lock one each."""
    responses = await asyncio.gather(
        post_booking(
            client,
            booking_body(
                service["id"], monday_10, professional_id=colleague.professional_id
            ),
        ),
        post_booking(
            client,
            booking_body(service["id"], monday_10, email="segunda@example.com"),
        ),
        post_booking(
            client,
            booking_body(
                service["id"],
                monday_10,
                professional_id=pro.professional_id,
                email="terceira@example.com",
            ),
        ),
    )

    # Two professionals, so at most two of the three get the time.
    statuses = sorted(item.status_code for item in responses)
    assert statuses in ([201, 201, 409], [201, 409, 409])
    assert await count_appointments(db) == statuses.count(201)


async def test_ct31_time_block_and_booking_at_the_same_time_leave_only_one(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booking, block = await asyncio.gather(
        post_booking(
            client,
            booking_body(service["id"], monday_10, professional_id=pro.professional_id),
        ),
        client.post(
            f"{API}/professionals/{pro.professional_id}/time-blocks",
            json={
                "starts_at": monday_10.isoformat(),
                "ends_at": (monday_10 + timedelta(hours=1)).isoformat(),
                "reason": "Folga",
            },
            headers=bearer(owner_token),
        ),
    )

    # Either one may win, but never both.
    assert sorted([booking.status_code, block.status_code]) == [201, 409]
    if booking.status_code == 409:
        assert booking.json()["code"] == "SLOT_UNAVAILABLE"
    else:
        assert block.json()["code"] == "APPOINTMENT_CONFLICTS"
    blocks = await db.scalar(select(func.count()).select_from(TimeBlock))
    assert (await count_appointments(db) or 0) + (blocks or 0) == 1


def change_while_waiting_for_the_locks(
    monkeypatch: MonkeyPatch, db: AsyncSession, statement: Any
) -> None:
    """Commits the change at the moment the request would be waiting."""
    original = professionals.lock_many

    async def lock_many(*args: Any, **kwargs: Any) -> None:
        await db.execute(statement)
        await db.commit()
        await original(*args, **kwargs)

    monkeypatch.setattr(professionals, "lock_many", lock_many)


async def test_service_deactivated_while_waiting_for_the_locks_answers_404(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    change_while_waiting_for_the_locks(
        monkeypatch, db, update(Service).values(is_active=False)
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 404
    assert await count_appointments(db) == 0


async def test_price_changed_while_waiting_for_the_locks_is_the_one_copied(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    change_while_waiting_for_the_locks(
        monkeypatch, db, update(Service).values(price_cents=9900)
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 201
    assert (await get_appointment(db, response.json()["id"])).price_cents == 9900


async def test_professional_removed_while_waiting_for_the_locks_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    change_while_waiting_for_the_locks(
        monkeypatch, db, update(Professional).values(is_bookable=False)
    )

    response = await post_booking(
        client,
        booking_body(service["id"], monday_10, professional_id=pro.professional_id),
    )

    assert response.status_code == 422
    assert await count_appointments(db) == 0


async def test_exclusion_constraint_is_the_last_defense(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """Even if the check in the application failed, the database answers 409."""
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    monkeypatch.setattr(public_booking, "available_slots", lambda *_, **__: [monday_10])

    response = await post_booking(
        client,
        booking_body(service["id"], monday_10, professional_id=pro.professional_id),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 0


async def test_two_simultaneous_reschedules_to_the_same_time_leave_one(
    client: AsyncClient,
    db: AsyncSession,
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
    target = monday_10 + timedelta(hours=3)

    responses = await asyncio.gather(
        reschedule_link(
            client, first_token, target, professional_id=pro.professional_id
        ),
        reschedule_link(
            client, second_token, target, professional_id=pro.professional_id
        ),
    )

    assert sorted(item.status_code for item in responses) == [200, 409]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["code"] == "SLOT_UNAVAILABLE"
    rows = [
        await get_appointment(db, first.json()["id"]),
        await get_appointment(db, second.json()["id"]),
    ]
    assert [row.starts_at == target for row in rows].count(True) == 1
    originals = {first.json()["id"]: monday_10, second.json()["id"]: second_start}
    kept = next(row for row in rows if row.starts_at != target)
    assert kept.starts_at == originals[str(kept.id)]
    assert await count_emails(db, "appointment_reschedule") == 1


async def test_reschedule_and_booking_of_the_same_time_leave_one(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    target = monday_10 + timedelta(hours=3)

    rescheduled, booked = await asyncio.gather(
        reschedule_link(client, token, target, professional_id=pro.professional_id),
        post_booking(
            client,
            booking_body(
                service["id"],
                target,
                professional_id=pro.professional_id,
                email="segunda@example.com",
            ),
        ),
    )

    assert sorted([rescheduled.status_code, booked.status_code]) in (
        [200, 409],
        [201, 409],
    )
    assert await count_appointments(db) == 1 + (booked.status_code == 201)


async def test_two_simultaneous_cancellations_of_the_same_link(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """The lock serializes them, so only one cancels and sends the e-mail."""
    _, token = await book(client, service["id"], monday_10)

    responses = await asyncio.gather(
        cancel_link(client, token), cancel_link(client, token)
    )

    assert sorted(item.status_code for item in responses) == [200, 409]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["code"] == "INVALID_STATUS_TRANSITION"
    assert await count_emails(db, "appointment_cancellation") == 1


async def test_cancel_and_reschedule_of_the_same_link_at_the_same_time(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """Whatever the order, no deadlock, and the appointment ends cancelled."""
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    cancelled, rescheduled = await asyncio.gather(
        cancel_link(client, token),
        reschedule_link(
            client,
            token,
            monday_10 + timedelta(hours=3),
            professional_id=pro.professional_id,
        ),
    )

    assert cancelled.status_code == 200
    assert rescheduled.status_code in (200, 409)
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.status.value == "cancelled"
