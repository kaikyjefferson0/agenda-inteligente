"""UC12 and UC13: reading and cancelling through the customer link."""

from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import generate_opaque_token
from app.models import Appointment, AppointmentStatus
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import Member
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    CUSTOMER_NAME,
    CUSTOMER_PHONE,
    SLUG,
    book,
    cancel_link,
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

CANCELLATION = "appointment_cancellation"
DEFAULT_DEADLINE = timedelta(hours=2)
LINK_HEADERS = {"cache-control": "no-store", "referrer-policy": "no-referrer"}


def deadline_of(starts_at: datetime) -> datetime:
    return starts_at - DEFAULT_DEADLINE


def assert_link_headers(response: Response) -> None:
    for name, value in LINK_HEADERS.items():
        assert response.headers[name] == value, (response.status_code, name)


def assert_no_customer_data(response: Response) -> None:
    for value in (CUSTOMER_NAME, CUSTOMER_EMAIL, CUSTOMER_PHONE):
        assert value not in response.text


async def set_status(
    db: AsyncSession, appointment_id: str, status: AppointmentStatus
) -> None:
    appointment = await get_appointment(db, appointment_id)
    await db.execute(
        update(Appointment)
        .where(Appointment.id == appointment.id)
        .values(status=status)
    )
    await db.commit()


async def test_d17_the_link_shows_the_appointment_and_the_allowed_actions(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(client, service["id"], monday_10)

    response = await get_link(client, token)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": booked.json()["id"],
        "status": "confirmed",
        "starts_at": local_iso(monday_10),
        "ends_at": local_iso(monday_10 + timedelta(minutes=30)),
        "business": {
            "name": "Barbearia",
            "slug": SLUG,
            "timezone": "America/Sao_Paulo",
        },
        "service": {
            "id": service["id"],
            "name": "Corte",
            "duration_minutes": 30,
            "price_cents": 5000,
        },
        "professional": {"id": pro.professional_id, "name": "Profissional"},
        "can_cancel": True,
        "can_reschedule": True,
        "change_deadline_at": local_iso(deadline_of(monday_10)),
    }


async def test_ct49_no_customer_data_and_the_link_headers_in_every_answer(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)

    responses = [
        await get_link(client, token),
        await get_link(client, generate_opaque_token()),
        await client.post(f"{link_path(token)}/reschedule", json={"x": 1}),
        await reschedule_link(client, token, monday_10),
        await client.delete(link_path(token)),
        await cancel_link(client, token),
        await cancel_link(client, token),
    ]

    assert [item.status_code for item in responses] == [
        200,
        404,
        422,
        409,
        405,
        200,
        409,
    ]
    for response in responses:
        assert_link_headers(response)
        assert_no_customer_data(response)


async def test_link_headers_stay_out_of_the_other_public_routes(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, _ = await book(client, service["id"], monday_10)

    assert "referrer-policy" not in booked.headers
    assert "cache-control" not in booked.headers


async def test_ct11_invalid_links_answer_the_same_404(
    client: AsyncClient,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)
    tampered = ("B" if token[0] == "A" else "A") + token[1:]
    invalid = [generate_opaque_token(), tampered, "nao.e.um.token", "x" * 200, "ç"]

    responses = [await get_link(client, item) for item in invalid]
    clock.now = monday_10 + timedelta(days=30, seconds=1)
    responses.append(await get_link(client, token))

    first = responses[0]
    assert first.json()["code"] == "NOT_FOUND"
    for response in responses:
        assert response.status_code == 404
        assert response.json() == first.json()
        assert response.headers["content-type"] == first.headers["content-type"]


@mark.parametrize("operation", ["cancel", "reschedule"])
async def test_ct11_changes_with_an_invalid_link_answer_404(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    operation: str,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    tampered = ("B" if token[0] == "A" else "A") + token[1:]

    async def change(item: str) -> Response:
        if operation == "cancel":
            return await cancel_link(client, item)
        return await reschedule_link(client, item, monday_10 + timedelta(hours=2))

    responses = [await change(tampered), await change("nao.e.um.token")]
    clock.now = monday_10 + timedelta(days=30, seconds=1)
    responses.append(await change(token))

    assert [item.status_code for item in responses] == [404, 404, 404]
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.status is AppointmentStatus.CONFIRMED
    assert appointment.starts_at == monday_10


async def test_rn16_the_link_still_works_on_the_30th_day_after_the_start(
    client: AsyncClient,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)
    clock.now = monday_10 + timedelta(days=30)

    response = await get_link(client, token)

    assert response.status_code == 200
    assert response.json()["can_cancel"] is False
    assert response.json()["can_reschedule"] is False


async def test_ct03_cancelling_by_the_link_offers_the_time_again(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    day = local_day(monday_10)
    assert local_iso(monday_10) not in offered(
        await get_availability(client, service["id"], day)
    )

    response = await cancel_link(client, token)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == booked.json()["id"]
    assert body["status"] == "cancelled"
    assert body["can_cancel"] is False
    assert body["can_reschedule"] is False
    assert body["email_status"] == "queued"
    assert local_iso(monday_10) in offered(
        await get_availability(client, service["id"], day)
    )
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.status is AppointmentStatus.CANCELLED
    assert appointment.cancelled_at == clock.now
    # The link keeps showing the appointment, now cancelled.
    assert (await get_link(client, token)).json()["status"] == "cancelled"


@mark.parametrize(
    ("offset", "expected"),
    [(timedelta(seconds=-1), 200), (timedelta(0), 200), (timedelta(seconds=1), 409)],
    ids=["before", "exact_limit", "after"],
)
async def test_ct12_cancelling_before_at_and_after_the_deadline(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    offset: timedelta,
    expected: int,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    clock.now = deadline_of(monday_10) + offset

    response = await cancel_link(client, token)

    assert response.status_code == expected, response.text
    appointment = await get_appointment(db, booked.json()["id"])
    if expected == 409:
        assert response.json()["code"] == "CHANGE_DEADLINE_PASSED"
        assert appointment.status is AppointmentStatus.CONFIRMED
        assert await count_emails(db, CANCELLATION) == 0
    else:
        assert appointment.status is AppointmentStatus.CANCELLED


async def test_the_deadline_is_the_one_configured_at_the_time_of_the_change(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """UC05: unlike the other settings, the deadline also affects existing ones."""
    _, token = await book(client, service["id"], monday_10)
    changed = await client.patch(
        f"{API}/business",
        json={"change_deadline_minutes": 30},
        headers=bearer(owner_token),
    )
    assert changed.status_code == 200, changed.text
    clock.now = monday_10 - timedelta(minutes=30)

    shown = await get_link(client, token)
    response = await cancel_link(client, token)

    assert shown.json()["change_deadline_at"] == local_iso(clock.now)
    assert shown.json()["can_cancel"] is True
    assert response.status_code == 200


@mark.parametrize(
    "status",
    [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
    ],
)
async def test_ct47_final_status_cannot_be_cancelled_nor_rescheduled(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    status: AppointmentStatus,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    await set_status(db, booked.json()["id"], status)

    cancelled = await cancel_link(client, token)
    rescheduled = await reschedule_link(client, token, monday_10 + timedelta(hours=2))
    shown = await get_link(client, token)

    for response in (cancelled, rescheduled):
        assert response.status_code == 409
        assert response.json()["code"] == "INVALID_STATUS_TRANSITION"
    assert shown.json()["status"] == status.value
    assert shown.json()["can_cancel"] is False
    assert shown.json()["can_reschedule"] is False
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.status is status
    assert appointment.starts_at == monday_10
    assert appointment.cancelled_at is None


async def test_ct47_cancelling_twice_is_refused_even_after_the_deadline(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """D19: the status comes before the deadline."""
    booked, token = await book(client, service["id"], monday_10)
    first = await cancel_link(client, token)
    cancelled_at = clock.now

    second = await cancel_link(client, token)
    clock.now = deadline_of(monday_10) + timedelta(seconds=1)
    third = await cancel_link(client, token)

    assert first.status_code == 200
    for response in (second, third):
        assert response.status_code == 409
        assert response.json()["code"] == "INVALID_STATUS_TRANSITION"
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.cancelled_at == cancelled_at
    assert await count_emails(db, CANCELLATION) == 1


async def test_d23_cancellation_email_without_customer_text(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)

    await cancel_link(client, token)

    messages = await emails_with(db, CANCELLATION)
    assert len(messages) == 1
    assert messages[0].to_email == CUSTOMER_EMAIL
    assert messages[0].payload == {
        "business_name": "Barbearia",
        "service_name": "Corte",
        "professional_name": "Profissional",
        "starts_at": local_iso(monday_10),
    }
    # RN25: nothing the customer typed goes to the e-mail, nor the link.
    assert CUSTOMER_NAME not in str(messages[0].payload)
    assert token not in str(messages[0].payload)


async def test_d23_cancellation_above_the_email_limit_is_kept_without_email(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, token = await book(client, service["id"], monday_10)
    # The booking spent the only e-mail of the day for this recipient.
    settings.email_recipient_daily_cap = 1

    response = await cancel_link(client, token)

    assert response.status_code == 200
    assert response.json()["email_status"] == "skipped"
    assert response.json()["status"] == "cancelled"
    assert await count_emails(db, CANCELLATION) == 0
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.status is AppointmentStatus.CANCELLED


async def test_cancellation_above_the_global_email_limit_is_kept_without_email(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)
    settings.email_daily_cap = 1

    response = await cancel_link(client, token)

    assert response.json()["email_status"] == "skipped"
    assert await count_emails(db, CANCELLATION) == 0
