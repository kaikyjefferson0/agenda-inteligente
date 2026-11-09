"""UC16: the manual booking by the team (RN19, D28, D29)."""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_opaque_token
from app.models import AppointmentOrigin, AppointmentStatus, Professional, Service
from tests.appointments.helpers import (
    AGENDA_FIELDS,
    CONFIRMATION,
    create_manual,
    manual_body,
    post_manual,
)
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    TUESDAY,
    Member,
    create_service,
    iso_utc,
    make_appointment,
    make_demo,
    next_local,
)
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    CUSTOMER_NAME,
    count_appointments,
    count_emails,
    emails_with,
    get_appointment,
    get_link,
    local_iso,
)

pytestmark = mark.anyio

ACCESS_URL_PREFIX = "https://app.test/agendamento/"


def token_of(created: dict[str, Any]) -> str:
    url: str = created["access_url"]
    assert url.startswith(ACCESS_URL_PREFIX)
    return url.removeprefix(ACCESS_URL_PREFIX)


async def assert_refused(
    client: AsyncClient,
    db: AsyncSession,
    token: str,
    body: dict[str, Any],
    status: int,
    code: str,
) -> dict[str, Any]:
    before = await count_appointments(db)
    response = await post_manual(client, token, body)
    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    assert await count_appointments(db) == before
    problem: dict[str, Any] = response.json()
    return problem


async def test_d28_the_owner_books_for_a_professional(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    response = await post_manual(
        client,
        owner_token,
        manual_body(pro.professional_id, service["id"], monday_10),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == AGENDA_FIELDS | {"access_url", "email_status"}
    assert body["professional_id"] == pro.professional_id
    assert body["service_name"] == "Corte"
    assert body["starts_at"] == iso_utc(monday_10)
    assert body["ends_at"] == iso_utc(monday_10 + timedelta(minutes=30))
    assert body["status"] == "confirmed"
    assert body["origin"] == "staff"
    assert body["customer_name"] == CUSTOMER_NAME
    appointment = await get_appointment(db, body["id"])
    assert appointment.origin is AppointmentOrigin.STAFF
    assert appointment.status is AppointmentStatus.CONFIRMED
    assert appointment.idempotency_key is None


async def test_d28_the_professional_books_in_the_own_agenda(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await create_manual(
        client, pro.token, pro.professional_id, service["id"], monday_10
    )

    assert created["professional_id"] == pro.professional_id


async def test_ct15_manual_booking_ignores_the_advance_limits_and_the_grid(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """RN19: the public side would refuse all three (min. 60 min, max. 30 days)."""
    clock.now = monday_10 - timedelta(minutes=5)
    times = [
        monday_10,
        monday_10 + timedelta(minutes=37),
        monday_10 + timedelta(weeks=52),
    ]

    for starts_at in times:
        created = await create_manual(
            client, owner_token, pro.professional_id, service["id"], starts_at
        )
        assert created["starts_at"] == iso_utc(starts_at)


async def test_ct16_manual_booking_over_another_appointment_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """RN04: the preparation also occupies, and the periods are half-open."""
    await make_appointment(
        db, pro.professional_id, service["id"], monday_10, preparation=10
    )

    for starts_at in (
        monday_10,
        monday_10 + timedelta(minutes=15),
        monday_10 + timedelta(minutes=35),
        monday_10 - timedelta(minutes=29),
    ):
        problem = await assert_refused(
            client,
            db,
            owner_token,
            manual_body(pro.professional_id, service["id"], starts_at),
            409,
            "SLOT_UNAVAILABLE",
        )
        assert "errors" not in problem

    # Starting when the preparation ends, or ending when the other starts.
    for starts_at in (
        monday_10 + timedelta(minutes=40),
        monday_10 - timedelta(minutes=30),
    ):
        await create_manual(
            client, owner_token, pro.professional_id, service["id"], starts_at
        )


async def test_ct16_a_cancelled_appointment_does_not_occupy(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        monday_10,
        status=AppointmentStatus.CANCELLED,
    )

    await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )


async def test_ct16_manual_booking_over_a_time_block_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    block = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": iso_utc(monday_10 + timedelta(hours=1)),
            "ends_at": iso_utc(monday_10 + timedelta(hours=2)),
            "reason": "Reunião",
        },
        headers=bearer(owner_token),
    )
    assert block.status_code == 201, block.text

    await assert_refused(
        client,
        db,
        owner_token,
        manual_body(
            pro.professional_id, service["id"], monday_10 + timedelta(minutes=45)
        ),
        409,
        "SLOT_UNAVAILABLE",
    )
    await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=2),
    )


async def test_ct35_manual_booking_in_the_past_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    clock.now = monday_10 + timedelta(minutes=1)

    await assert_refused(
        client,
        db,
        owner_token,
        manual_body(pro.professional_id, service["id"], monday_10),
        409,
        "SLOT_UNAVAILABLE",
    )
    # The present instant is not in the past.
    clock.now = monday_10
    await create_manual(
        client, owner_token, pro.professional_id, service["id"], monday_10
    )


async def test_ct35_manual_booking_outside_the_working_hours_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """RN03: the whole block, inside a single interval (09:00 to 18:00)."""
    for starts_at in (
        monday_10 - timedelta(hours=1, minutes=30),
        monday_10 + timedelta(hours=7, minutes=45),
        next_local(monday_10, TUESDAY, "10:00"),
    ):
        await assert_refused(
            client,
            db,
            owner_token,
            manual_body(pro.professional_id, service["id"], starts_at),
            409,
            "SLOT_UNAVAILABLE",
        )

    await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=7, minutes=30),
    )


async def test_ct35_the_preparation_must_fit_the_working_hours(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await db.execute(update(Service).values(preparation_minutes=10))
    await db.commit()

    await assert_refused(
        client,
        db,
        owner_token,
        manual_body(
            pro.professional_id,
            service["id"],
            monday_10 + timedelta(hours=7, minutes=30),
        ),
        409,
        "SLOT_UNAVAILABLE",
    )
    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=7, minutes=20),
    )
    assert created["blocked_until"] == iso_utc(monday_10 + timedelta(hours=8))
    assert created["preparation_minutes"] == 10


async def test_ct52_without_email_there_is_no_link_and_no_email(
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
        phone=None,
    )

    assert created["access_url"] is None
    assert created["email_status"] == "none"
    assert created["customer_email"] is None
    assert created["customer_phone"] is None
    appointment = await get_appointment(db, created["id"])
    assert appointment.access_token_hash is None
    assert appointment.link_email_skipped is False
    assert await count_emails(db, CONFIRMATION) == 0


async def test_ct52_with_email_the_link_works_and_the_email_is_queued(
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

    assert created["email_status"] == "queued"
    token = token_of(created)
    appointment = await get_appointment(db, created["id"])
    assert appointment.access_token_hash == hash_opaque_token(token)
    assert appointment.link_email_skipped is False
    link = await get_link(client, token)
    assert link.status_code == 200, link.text
    assert link.json()["id"] == created["id"]
    assert link.json()["starts_at"] == local_iso(monday_10)

    # D29: the template and the content of the public booking (D10).
    [message] = await emails_with(db, CONFIRMATION)
    assert message.to_email == CUSTOMER_EMAIL
    assert message.payload == {
        "url": created["access_url"],
        "business_name": "Barbearia",
        "service_name": "Corte",
        "professional_name": "Profissional",
        "starts_at": local_iso(monday_10),
    }
    assert CUSTOMER_NAME not in str(message.payload)


async def test_d29_above_the_email_limit_the_link_is_only_in_the_answer(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.email_recipient_daily_cap = 0

    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10,
        email=CUSTOMER_EMAIL,
    )

    assert created["email_status"] == "skipped"
    assert (await get_link(client, token_of(created))).status_code == 200
    appointment = await get_appointment(db, created["id"])
    assert appointment.link_email_skipped is True
    assert await count_emails(db, CONFIRMATION) == 0


async def test_d28_the_demo_business_books_normally(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await make_demo(db)

    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10,
        email=CUSTOMER_EMAIL,
    )

    assert created["email_status"] == "queued"


async def test_ct54_an_inactive_service_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    deactivated = await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )
    assert deactivated.status_code == 200, deactivated.text

    problem = await assert_refused(
        client,
        db,
        owner_token,
        manual_body(pro.professional_id, service["id"], monday_10),
        422,
        "VALIDATION_ERROR",
    )
    assert problem["errors"][0]["loc"] == ["body", "service_id"]


async def test_ct54_a_professional_who_cannot_be_booked_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    other_service = await create_service(client, owner_token, name="Barba")

    problem = await assert_refused(
        client,
        db,
        owner_token,
        manual_body(pro.professional_id, other_service["id"], monday_10),
        422,
        "VALIDATION_ERROR",
    )
    assert problem["errors"][0]["loc"] == ["body", "professional_id"]

    await db.execute(
        update(Professional)
        .where(Professional.id == UUID(pro.professional_id))
        .values(is_bookable=False)
    )
    await db.commit()
    await assert_refused(
        client,
        db,
        owner_token,
        manual_body(pro.professional_id, service["id"], monday_10),
        422,
        "VALIDATION_ERROR",
    )


@mark.parametrize(
    "offset",
    [timedelta(seconds=30), timedelta(microseconds=500)],
    ids=["seconds", "microseconds"],
)
async def test_ct54_a_time_with_seconds_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    offset: timedelta,
) -> None:
    problem = await assert_refused(
        client,
        db,
        owner_token,
        manual_body(pro.professional_id, service["id"], monday_10 + offset),
        422,
        "VALIDATION_ERROR",
    )
    assert problem["errors"][0]["loc"] == ["body", "starts_at"]


async def test_d28_missing_resources_answer_404(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    for body in (
        manual_body(str(uuid4()), service["id"], monday_10),
        manual_body(pro.professional_id, str(uuid4()), monday_10),
    ):
        await assert_refused(client, db, owner_token, body, 404, "NOT_FOUND")


@mark.parametrize(
    "change",
    [
        {"business_id": "00000000-0000-4000-8000-000000000000"},
        {"customer": {"name": CUSTOMER_NAME, "notes": "texto livre"}},
        {"customer": {"name": ""}},
        {"customer": {"name": "Nome\x00nulo"}},
        {"customer": {"name": "x" * 121}},
        {"customer": {"email": CUSTOMER_EMAIL}},
        {"customer": {"name": CUSTOMER_NAME, "email": "sem-arroba"}},
        {"customer": {"name": CUSTOMER_NAME, "phone": "11 99999-9999"}},
        {"starts_at": "2030-03-04T10:00:00"},
        {"starts_at": None},
    ],
    ids=[
        "unknown_field",
        "unknown_customer_field",
        "empty_name",
        "null_character",
        "long_name",
        "missing_name",
        "invalid_email",
        "invalid_phone",
        "naive_time",
        "null_time",
    ],
)
async def test_d28_invalid_bodies_answer_422(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    change: dict[str, Any],
) -> None:
    body = {**manual_body(pro.professional_id, service["id"], monday_10), **change}

    await assert_refused(client, db, owner_token, body, 422, "VALIDATION_ERROR")
