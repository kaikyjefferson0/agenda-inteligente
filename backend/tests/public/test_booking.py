from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_opaque_token
from app.models import (
    AppointmentOrigin,
    AppointmentStatus,
    EmailOutbox,
    Professional,
)
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    MONDAY,
    Member,
    interval,
    make_appointment,
    make_demo,
    next_local,
    put_hours,
)
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    CUSTOMER_NAME,
    CUSTOMER_PHONE,
    OTHER_SLUG,
    booking_body,
    count_appointments,
    count_emails,
    get_appointment,
    get_availability,
    link_services,
    link_token,
    local_day,
    local_iso,
    offered,
    page_path,
    post_booking,
)

pytestmark = mark.anyio


async def test_booking_is_confirmed_and_returns_the_link(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    response = await post_booking(
        client,
        booking_body(service["id"], monday_10, professional_id=pro.professional_id),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    token = link_token(response)
    assert body.pop("id")
    assert body == {
        "status": "confirmed",
        "starts_at": local_iso(monday_10),
        "ends_at": local_iso(monday_10 + timedelta(minutes=30)),
        "service": {"name": "Corte", "price_cents": 5000},
        "professional": {"name": "Profissional"},
        "access_url": f"https://app.test/agendamento/{token}",
        "email_status": "queued",
    }
    assert CUSTOMER_EMAIL not in response.text
    assert CUSTOMER_PHONE not in response.text


async def test_booking_stores_the_row_with_copied_values_and_only_the_token_hash(
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
    key = str(uuid4())

    response = await post_booking(
        client, booking_body(service["id"], monday_10), key=key
    )

    appointment = await get_appointment(db, response.json()["id"])
    token = link_token(response)
    assert appointment.access_token_hash == hash_opaque_token(token)
    assert token not in str(vars(appointment))
    assert appointment.status is AppointmentStatus.CONFIRMED
    assert appointment.origin is AppointmentOrigin.PUBLIC
    assert appointment.starts_at == monday_10
    assert appointment.ends_at == monday_10 + timedelta(minutes=30)
    assert appointment.blocked_until == monday_10 + timedelta(minutes=40)
    assert appointment.duration_minutes == 30
    assert appointment.preparation_minutes == 10
    assert appointment.price_cents == 5000
    assert appointment.customer_name == CUSTOMER_NAME
    assert appointment.customer_email == CUSTOMER_EMAIL
    assert appointment.customer_phone == CUSTOMER_PHONE
    assert appointment.idempotency_key == key
    assert appointment.link_email_skipped is False


async def test_booking_enqueues_the_email_without_customer_text(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    response = await post_booking(client, booking_body(service["id"], monday_10))

    messages = list(
        await db.scalars(
            select(EmailOutbox).where(EmailOutbox.to_email == CUSTOMER_EMAIL)
        )
    )
    assert len(messages) == 1
    assert messages[0].template == "appointment_confirmation"
    assert messages[0].payload == {
        "url": response.json()["access_url"],
        "business_name": "Barbearia",
        "service_name": "Corte",
        "professional_name": "Profissional",
        "starts_at": local_iso(monday_10),
    }
    # RN25: nothing the customer typed goes to the e-mail.
    assert CUSTOMER_NAME not in str(messages[0].payload)


async def test_ct10_changing_the_service_does_not_touch_the_appointment(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)
    created = await post_booking(client, body, key=key)

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

    appointment = await get_appointment(db, created.json()["id"])
    assert appointment.duration_minutes == 30
    assert appointment.preparation_minutes == 0
    assert appointment.price_cents == 5000
    assert appointment.ends_at == monday_10 + timedelta(minutes=30)
    assert appointment.blocked_until == monday_10 + timedelta(minutes=30)

    repeated = await post_booking(client, body, key=key)
    assert repeated.json()["service"] == {"name": "Corte novo", "price_cents": 5000}
    assert repeated.json()["ends_at"] == local_iso(monday_10 + timedelta(minutes=30))


async def test_booked_time_is_no_longer_offered(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await post_booking(client, booking_body(service["id"], monday_10))

    slots = offered(await get_availability(client, service["id"], local_day(monday_10)))

    assert local_iso(monday_10) not in slots


async def test_ct08_professional_who_does_not_serve_the_service_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await link_services(client, owner_token, pro.professional_id)

    response = await post_booking(
        client,
        booking_body(service["id"], monday_10, professional_id=pro.professional_id),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.json()["errors"][0]["loc"] == ["body", "professional_id"]
    assert await count_appointments(db) == 0
    assert await count_emails(db) == 0


async def test_professional_who_is_not_bookable_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await db.execute(update(Professional).values(is_bookable=False))
    await db.commit()

    response = await post_booking(
        client,
        booking_body(service["id"], monday_10, professional_id=pro.professional_id),
    )

    assert response.status_code == 422
    assert await count_appointments(db) == 0


async def test_unknown_slug_answers_404(
    client: AsyncClient, service: dict[str, Any], monday_10: datetime
) -> None:
    response = await post_booking(
        client, booking_body(service["id"], monday_10), slug="nao-existe"
    )

    assert response.status_code == 404


async def test_unknown_service_answers_404(
    client: AsyncClient, db: AsyncSession, pro: Member, monday_10: datetime
) -> None:
    response = await post_booking(client, booking_body(str(uuid4()), monday_10))

    assert response.status_code == 404
    assert await count_appointments(db) == 0


async def test_inactive_service_answers_404(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 404
    assert await count_appointments(db) == 0


async def test_unknown_professional_answers_404(
    client: AsyncClient, service: dict[str, Any], pro: Member, monday_10: datetime
) -> None:
    response = await post_booking(
        client, booking_body(service["id"], monday_10, professional_id=str(uuid4()))
    )

    assert response.status_code == 404


async def test_occupied_time_answers_409(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(db, pro.professional_id, service["id"], monday_10)

    response = await post_booking(
        client,
        booking_body(service["id"], monday_10, professional_id=pro.professional_id),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"
    assert await count_emails(db) == 0


async def test_time_covered_by_a_block_answers_409(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": monday_10.isoformat(),
            "ends_at": (monday_10 + timedelta(minutes=15)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(owner_token),
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"


async def test_time_outside_working_hours_answers_409(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    clock: Clock,
) -> None:
    response = await post_booking(
        client, booking_body(service["id"], next_local(clock.now, MONDAY, "19:00"))
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"


async def test_block_that_passes_closing_time_answers_409(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    clock: Clock,
) -> None:
    response = await post_booking(
        client, booking_body(service["id"], next_local(clock.now, MONDAY, "17:45"))
    )

    assert response.status_code == 409


@mark.parametrize(
    "starts_at",
    ["2020-01-06T10:00:00-03:00", "0001-01-01T00:00:00Z", "2099-01-05T10:00:00-03:00"],
    ids=["past", "first_date", "too_far"],
)
async def test_time_outside_the_advance_window_answers_409(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    starts_at: str,
) -> None:
    response = await post_booking(client, booking_body(service["id"], starts_at))

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"


async def test_exact_minimum_advance_is_accepted(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
    clock: Clock,
) -> None:
    clock.now = monday_10 - timedelta(minutes=60)
    accepted = await post_booking(client, booking_body(service["id"], monday_10))

    clock.now += timedelta(seconds=1)
    refused = await post_booking(
        client, booking_body(service["id"], monday_10, email="outra@example.com")
    )

    assert accepted.status_code == 201
    assert refused.status_code == 409


@mark.parametrize("delta", [timedelta(minutes=7), timedelta(seconds=1)])
async def test_time_off_the_grid_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    delta: timedelta,
) -> None:
    response = await post_booking(
        client, booking_body(service["id"], monday_10 + delta)
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.json()["errors"][0]["loc"] == ["body", "starts_at"]
    assert await count_appointments(db) == 0


async def test_only_the_first_occurrence_of_a_repeated_time_is_accepted(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    clock: Clock,
) -> None:
    changed = await client.patch(
        f"{API}/business",
        json={"timezone": "America/New_York"},
        headers=bearer(owner_token),
    )
    assert changed.status_code == 200
    await put_hours(
        client, owner_token, pro.professional_id, interval(6, "01:00", "02:00")
    )
    clock.now = datetime(2030, 10, 25, tzinfo=UTC)

    second = await post_booking(
        client, booking_body(service["id"], "2030-11-03T01:15:00-05:00")
    )
    first = await post_booking(
        client, booking_body(service["id"], "2030-11-03T01:15:00-04:00")
    )

    assert second.status_code == 422
    assert first.status_code == 201
    assert first.json()["starts_at"] == "2030-11-03T01:15:00-04:00"


async def test_a_time_sent_with_the_old_offset_is_read_as_the_real_instant(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    clock: Clock,
) -> None:
    await client.patch(
        f"{API}/business",
        json={"timezone": "America/New_York"},
        headers=bearer(owner_token),
    )
    await put_hours(
        client, owner_token, pro.professional_id, interval(6, "01:00", "04:00")
    )
    clock.now = datetime(2030, 3, 1, tzinfo=UTC)

    # 02:30 does not exist that day. With this offset, it is the instant of 03:30.
    response = await post_booking(
        client, booking_body(service["id"], "2030-03-10T02:30:00-05:00")
    )

    assert response.status_code == 201
    assert response.json()["starts_at"] == "2030-03-10T03:30:00-04:00"


async def test_no_preference_goes_to_whoever_has_fewer_appointments(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(
        db, pro.professional_id, service["id"], monday_10 + timedelta(hours=3)
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    appointment = await get_appointment(db, response.json()["id"])
    assert str(appointment.professional_id) == colleague.professional_id


async def test_no_preference_tie_goes_to_the_oldest_registration(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    response = await post_booking(client, booking_body(service["id"], monday_10))

    appointment = await get_appointment(db, response.json()["id"])
    assert str(appointment.professional_id) == pro.professional_id


async def test_no_preference_skips_whoever_is_busy_at_that_time(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    await make_appointment(
        db, colleague.professional_id, service["id"], monday_10 + timedelta(hours=2)
    )
    await make_appointment(
        db, colleague.professional_id, service["id"], monday_10 + timedelta(hours=3)
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    appointment = await get_appointment(db, response.json()["id"])
    assert str(appointment.professional_id) == colleague.professional_id


async def test_no_preference_counts_only_appointments_that_are_not_cancelled(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=3),
        status=AppointmentStatus.CANCELLED,
    )

    response = await post_booking(client, booking_body(service["id"], monday_10))

    appointment = await get_appointment(db, response.json()["id"])
    assert str(appointment.professional_id) == pro.professional_id


async def test_no_preference_without_anyone_eligible_answers_409(
    client: AsyncClient,
    service: dict[str, Any],
    monday_10: datetime,
) -> None:
    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 409
    assert response.json()["code"] == "SLOT_UNAVAILABLE"


async def test_demo_business_accepts_bookings(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await make_demo(db)

    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 201
    assert await count_emails(db) == 1


def customer_with(**changes: Any) -> dict[str, Any]:
    return {
        "customer": {
            "name": CUSTOMER_NAME,
            "email": CUSTOMER_EMAIL,
            "phone": CUSTOMER_PHONE,
            **changes,
        }
    }


@mark.parametrize(
    "changes",
    [
        customer_with(name=""),
        customer_with(name="   "),
        customer_with(name="x" * 121),
        customer_with(name="Nome\x00nulo"),
        customer_with(name="Nome\x07controle"),
        customer_with(name="Nome\nquebra"),
        customer_with(email="sem-arroba"),
        customer_with(phone="11999999999"),
        customer_with(phone="+55 11 99999-9999"),
        customer_with(phone="+0511999999999"),
        customer_with(phone="+5511999999999\n"),
        customer_with(phone="+1234567"),
        customer_with(phone="+1234567890123456"),
        customer_with(name=None),
        customer_with(email=None),
        customer_with(phone=None),
        customer_with(extra="x"),
        {"customer": None},
        {"service_id": "abc"},
        {"professional_id": "abc"},
        {"starts_at": "2030-01-07T10:00:00"},
        {"starts_at": "ontem"},
        {"starts_at": "9999-12-31T23:59:59-14:00"},
        {"business_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"},
    ],
)
async def test_invalid_data_answers_422_and_creates_nothing(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    monday_10: datetime,
    changes: dict[str, Any],
) -> None:
    body = {**booking_body(service["id"], monday_10), **changes}

    response = await post_booking(client, body)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert await count_appointments(db) == 0


async def test_invalid_customer_data_is_not_echoed(
    client: AsyncClient,
    service: dict[str, Any],
    monday_10: datetime,
) -> None:
    body = booking_body(service["id"], monday_10, phone="Marcador-de-teste")

    response = await post_booking(client, body)

    assert response.status_code == 422
    assert "Marcador-de-teste" not in response.text


async def test_service_of_another_business_answers_404(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    response = await post_booking(
        client, booking_body(other_business["service_id"], monday_10)
    )

    assert response.status_code == 404
    assert await count_appointments(db) == 0


async def test_professional_of_another_business_answers_404(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    response = await post_booking(
        client,
        booking_body(
            service["id"],
            monday_10,
            professional_id=other_business["professional_id"],
        ),
    )

    assert response.status_code == 404
    assert await count_appointments(db) == 0


async def test_booking_stays_in_the_business_of_the_slug(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    response = await post_booking(
        client,
        booking_body(other_business["service_id"], monday_10),
        slug=OTHER_SLUG,
    )

    appointment = await get_appointment(db, response.json()["id"])
    assert str(appointment.professional_id) == other_business["professional_id"]
    # The first business stays free at the same time.
    assert local_iso(monday_10) in offered(
        await get_availability(client, service["id"], local_day(monday_10))
    )


async def test_route_with_a_null_character_in_the_slug_answers_404(
    client: AsyncClient, service: dict[str, Any], monday_10: datetime
) -> None:
    response = await client.post(
        f"{page_path('com%00nulo')}/appointments",
        json=booking_body(service["id"], monday_10),
        headers={"Idempotency-Key": str(uuid4())},
    )

    assert response.status_code == 404
