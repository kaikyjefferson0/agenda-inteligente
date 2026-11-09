"""UC14: rescheduling through the customer link (RN18)."""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from pytest import MonkeyPatch, mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_opaque_token
from app.models import Appointment, AppointmentStatus, Professional
from app.services import public_booking
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import Member, add_member, make_appointment
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    CUSTOMER_NAME,
    book,
    cancel_link,
    count_appointments,
    count_emails,
    emails_with,
    get_appointment,
    get_availability,
    get_link,
    link_path,
    local_day,
    local_iso,
    offered,
    reschedule_link,
)

pytestmark = mark.anyio

RESCHEDULE = "appointment_reschedule"
DEFAULT_DEADLINE = timedelta(hours=2)


async def assert_unchanged(
    db: AsyncSession, appointment_id: str, starts_at: datetime, professional_id: str
) -> None:
    """CT13 and D20: every refusal keeps the original as it was."""
    appointment = await get_appointment(db, appointment_id)
    assert appointment.status is AppointmentStatus.CONFIRMED
    assert appointment.starts_at == starts_at
    assert appointment.ends_at == starts_at + timedelta(minutes=30)
    assert appointment.blocked_until == starts_at + timedelta(minutes=30)
    assert str(appointment.professional_id) == professional_id
    assert await count_emails(db, RESCHEDULE) == 0


async def test_ct14_rescheduling_to_a_free_time_swaps_the_same_row(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    new_time = monday_10 + timedelta(hours=2)

    response = await reschedule_link(
        client, token, new_time, professional_id=pro.professional_id
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == booked.json()["id"]
    assert body["status"] == "confirmed"
    assert body["starts_at"] == local_iso(new_time)
    assert body["ends_at"] == local_iso(new_time + timedelta(minutes=30))
    assert body["change_deadline_at"] == local_iso(new_time - DEFAULT_DEADLINE)
    assert body["professional"]["id"] == pro.professional_id
    assert body["can_reschedule"] is True
    assert body["email_status"] == "queued"
    assert await count_appointments(db) == 1
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.starts_at == new_time
    assert appointment.blocked_until == new_time + timedelta(minutes=30)
    # Same link: the hash did not change, and the token still opens it.
    assert appointment.access_token_hash == hash_opaque_token(token)
    assert (await get_link(client, token)).json()["starts_at"] == local_iso(new_time)
    slots = offered(await get_availability(client, service["id"], local_day(monday_10)))
    assert local_iso(monday_10) in slots
    assert local_iso(new_time) not in slots


async def test_ct14_the_professional_may_change(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(
        client, token, monday_10, professional_id=colleague.professional_id
    )

    assert response.status_code == 200, response.text
    assert response.json()["professional"] == {
        "id": colleague.professional_id,
        "name": "Profissional",
    }
    appointment = await get_appointment(db, booked.json()["id"])
    assert str(appointment.professional_id) == colleague.professional_id
    pro_slots = offered(
        await get_availability(
            client,
            service["id"],
            local_day(monday_10),
            professional_id=pro.professional_id,
        )
    )
    assert local_iso(monday_10) in pro_slots


async def test_no_preference_ignores_the_appointment_itself_in_the_count(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    """D20: counting it, `pro` would have one more and lose the tie of RN10."""
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(client, token, monday_10 + timedelta(hours=2))

    assert response.status_code == 200, response.text
    assert response.json()["professional"]["id"] == pro.professional_id


async def test_no_preference_goes_to_someone_free_when_the_current_one_overlaps(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(client, token, monday_10 + timedelta(minutes=15))

    assert response.status_code == 200, response.text
    assert response.json()["professional"]["id"] == colleague.professional_id


async def test_professional_id_may_be_left_out(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)

    response = await client.post(
        f"{link_path(token)}/reschedule",
        json={"starts_at": local_iso(monday_10 + timedelta(hours=1))},
    )

    assert response.status_code == 200, response.text


async def test_ct10_rescheduling_keeps_the_copied_values(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await client.patch(
        f"{API}/services/{service['id']}",
        json={"preparation_minutes": 10},
        headers=bearer(owner_token),
    )
    booked, token = await book(client, service["id"], monday_10)
    changed = await client.patch(
        f"{API}/services/{service['id']}",
        json={
            "name": "Corte novo",
            "duration_minutes": 90,
            "preparation_minutes": 30,
            "price_cents": 9900,
        },
        headers=bearer(owner_token),
    )
    assert changed.status_code == 200
    # 17:15 fits 30 + 10 minutes before 18:00, but not the new 90 + 30.
    new_time = monday_10 + timedelta(hours=7, minutes=15)

    response = await reschedule_link(client, token, new_time)

    assert response.status_code == 200, response.text
    assert response.json()["service"] == {
        "id": service["id"],
        "name": "Corte novo",
        "duration_minutes": 30,
        "price_cents": 5000,
    }
    assert response.json()["ends_at"] == local_iso(new_time + timedelta(minutes=30))
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.service_id == UUID(service["id"])
    assert appointment.duration_minutes == 30
    assert appointment.preparation_minutes == 10
    assert appointment.price_cents == 5000
    assert appointment.ends_at == new_time + timedelta(minutes=30)
    assert appointment.blocked_until == new_time + timedelta(minutes=40)


async def test_ct13_rescheduling_to_an_occupied_time_keeps_the_original(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    taken = monday_10 + timedelta(hours=2)
    await book(
        client,
        service["id"],
        taken,
        professional_id=pro.professional_id,
        email="outra@example.com",
    )

    response = await reschedule_link(
        client, token, taken, professional_id=pro.professional_id
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)
    slots = offered(await get_availability(client, service["id"], local_day(monday_10)))
    assert local_iso(monday_10) not in slots


async def test_ct13_the_exclusion_constraint_also_keeps_the_original(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """Even if the check in the application failed, the database answers 409."""
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    taken = monday_10 + timedelta(hours=2)
    await make_appointment(db, pro.professional_id, service["id"], taken)
    monkeypatch.setattr(public_booking, "available_slots", lambda *_, **__: [taken])

    response = await reschedule_link(
        client, token, taken, professional_id=pro.professional_id
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)
    assert (await get_link(client, token)).json()["starts_at"] == local_iso(monday_10)


@mark.parametrize(
    "minutes", [0, 15, -15], ids=["same_time", "starts_inside", "ends_inside"]
)
async def test_rn18_a_time_over_the_current_one_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    minutes: int,
) -> None:
    """Repeating a reschedule falls on its own time, so it answers 409 (D22)."""
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(
        client,
        token,
        monday_10 + timedelta(minutes=minutes),
        professional_id=pro.professional_id,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


async def test_repeating_a_reschedule_answers_409(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    new_time = monday_10 + timedelta(hours=2)

    first = await reschedule_link(
        client, token, new_time, professional_id=pro.professional_id
    )
    second = await reschedule_link(
        client, token, new_time, professional_id=pro.professional_id
    )

    assert [first.status_code, second.status_code] == [200, 409]
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.starts_at == new_time
    assert await count_emails(db, RESCHEDULE) == 1


@mark.parametrize(
    ("offset", "expected"),
    [(timedelta(seconds=-1), 200), (timedelta(0), 200), (timedelta(seconds=1), 409)],
    ids=["before", "exact_limit", "after"],
)
async def test_ct12_rescheduling_before_at_and_after_the_deadline(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    offset: timedelta,
    expected: int,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    clock.now = monday_10 - DEFAULT_DEADLINE + offset

    response = await reschedule_link(client, token, monday_10 + timedelta(hours=2))

    assert response.status_code == expected, response.text
    if expected == 409:
        assert response.json()["code"] == "CHANGE_DEADLINE_PASSED"
        await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


async def test_the_deadline_is_checked_before_the_new_time(
    client: AsyncClient,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """D19: the refusals about the appointment come before the ones about the body."""
    _, token = await book(client, service["id"], monday_10)
    clock.now = monday_10 - DEFAULT_DEADLINE + timedelta(seconds=1)

    response = await reschedule_link(
        client, token, monday_10 + timedelta(minutes=7), professional_id=str(uuid4())
    )

    assert response.json()["code"] == "CHANGE_DEADLINE_PASSED"


async def test_ct48_rescheduling_after_the_service_is_deactivated(
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
    deactivated = await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )
    assert deactivated.status_code == 200

    shown = await get_link(client, token)
    rescheduled = await reschedule_link(client, token, monday_10 + timedelta(hours=2))

    assert shown.json()["can_reschedule"] is False
    assert shown.json()["can_cancel"] is True
    assert rescheduled.status_code == 409
    assert rescheduled.json()["code"] == "SLOT_UNAVAILABLE"
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)
    cancelled = await cancel_link(client, token)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


async def test_off_the_grid_answers_422_and_keeps_the_original(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(client, token, monday_10 + timedelta(minutes=67))

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.json()["errors"][0]["loc"] == ["body", "starts_at"]
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


@mark.parametrize(
    ("now_offset", "new_offset"),
    [
        (None, timedelta(hours=8)),
        (timedelta(hours=-3), timedelta(hours=-2, minutes=-30)),
        (None, timedelta(days=35)),
    ],
    ids=["outside_working_hours", "before_min_advance", "after_max_advance"],
)
async def test_unavailable_times_answer_409_and_keep_the_original(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    now_offset: timedelta | None,
    new_offset: timedelta,
) -> None:
    """Offsets from 14:00. The minimum advance: 11:30 when it is 11:00."""
    current = monday_10 + timedelta(hours=4)
    booked, token = await book(
        client, service["id"], current, professional_id=pro.professional_id
    )
    if now_offset is not None:
        clock.now = current + now_offset

    response = await reschedule_link(
        client, token, current + new_offset, professional_id=pro.professional_id
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "SLOT_UNAVAILABLE"
    await assert_unchanged(db, booked.json()["id"], current, pro.professional_id)


async def test_unknown_professional_answers_404(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(
        client, token, monday_10 + timedelta(hours=2), professional_id=str(uuid4())
    )

    assert response.status_code == 404
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


async def test_professional_of_another_business_answers_404(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    other_business: dict[str, Any],
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await reschedule_link(
        client,
        token,
        monday_10 + timedelta(hours=2),
        professional_id=other_business["professional_id"],
    )

    assert response.status_code == 404
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


async def test_professional_who_does_not_serve_the_service_answers_422(
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
    outsider = await add_member(client, db, owner_token, "fora@example.com")

    response = await reschedule_link(
        client,
        token,
        monday_10 + timedelta(hours=2),
        professional_id=outsider.professional_id,
    )

    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "professional_id"]
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


async def test_professional_who_is_not_bookable_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    await db.execute(
        update(Professional)
        .where(Professional.id == UUID(colleague.professional_id))
        .values(is_bookable=False)
    )
    await db.commit()

    response = await reschedule_link(
        client,
        token,
        monday_10 + timedelta(hours=2),
        professional_id=colleague.professional_id,
    )

    assert response.status_code == 422
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


@mark.parametrize(
    "body",
    [
        {},
        {"starts_at": "ontem"},
        {"starts_at": "2030-01-07T10:00:00"},
        {"starts_at": "9999-12-31T23:59:59-23:59"},
        {"starts_at": "2030-01-07T10:00:00-03:00", "professional_id": "abc"},
        {"starts_at": "2030-01-07T10:00:00-03:00", "service_id": str(uuid4())},
        {"starts_at": "2030-01-07T10:00:00-03:00", "customer": {"name": "Outro"}},
    ],
    ids=[
        "missing",
        "not_a_date",
        "no_offset",
        "out_of_range",
        "bad_professional",
        "unknown_service_field",
        "unknown_customer_field",
    ],
)
async def test_invalid_bodies_answer_422_and_keep_the_original(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    body: dict[str, Any],
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    response = await client.post(f"{link_path(token)}/reschedule", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    await assert_unchanged(db, booked.json()["id"], monday_10, pro.professional_id)


async def test_a_staff_appointment_follows_the_same_rules(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """RN16: a staff appointment with e-mail also has a link."""
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], monday_10, customer_email="x@x.com"
    )
    token = "token-de-equipe"
    await db.execute(
        update(Appointment)
        .where(Appointment.id == appointment.id)
        .values(access_token_hash=hash_opaque_token(token))
    )
    await db.commit()

    response = await reschedule_link(client, token, monday_10 + timedelta(hours=2))

    assert response.status_code == 200, response.text
    assert (await emails_with(db, RESCHEDULE))[0].to_email == "x@x.com"


async def test_d23_reschedule_email_with_the_same_link(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    new_time = monday_10 + timedelta(hours=2)

    await reschedule_link(client, token, new_time)

    messages = await emails_with(db, RESCHEDULE)
    assert len(messages) == 1
    assert messages[0].to_email == CUSTOMER_EMAIL
    assert messages[0].payload == {
        "url": booked.json()["access_url"],
        "business_name": "Barbearia",
        "service_name": "Corte",
        "professional_name": "Profissional",
        "starts_at": local_iso(new_time),
    }
    assert CUSTOMER_NAME not in str(messages[0].payload)


async def test_d23_reschedule_above_the_email_limit_is_kept_without_email(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    settings.email_recipient_daily_cap = 1
    new_time = monday_10 + timedelta(hours=2)

    response = await reschedule_link(client, token, new_time)

    assert response.status_code == 200
    assert response.json()["email_status"] == "skipped"
    assert response.json()["starts_at"] == local_iso(new_time)
    assert await count_emails(db, RESCHEDULE) == 0
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.starts_at == new_time
