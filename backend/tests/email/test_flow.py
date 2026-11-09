"""From the operation to the inbox: the API queues, the worker sends."""

from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from pytest import mark
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.auth import INVITE_TTL, PASSWORD_RESET_TTL
from app.domain.email_retry import FailureKind
from app.email.fake import FakeSender
from app.email.templates import EmailTemplate
from app.jobs.email_worker import run_once
from app.models import AppointmentStatus, EmailOutboxStatus
from tests.appointments.helpers import act, create_manual, staff_reschedule
from tests.auth.helpers import API, OWNER_EMAIL, Clock, invite
from tests.configuration.helpers import BUSINESS_TIME_ZONE, Member
from tests.email.helpers import all_messages, worker_now
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    CUSTOMER_NAME,
    CUSTOMER_PHONE,
    book,
    cancel_link,
    get_appointment,
    get_link,
    reschedule_link,
)

pytestmark = mark.anyio

SessionFactory = async_sessionmaker[AsyncSession]


async def drain(session_factory: SessionFactory) -> None:
    """Sends what the fixtures queued, such as the invitation of `pro`."""
    await run_once(session_factory, FakeSender(), worker_now())


def assert_no_customer_data(sender: FakeSender) -> None:
    """D10: the recipient is the customer, but the content never names them."""
    for item in sender.sent:
        content = item.message.subject + item.message.text + item.message.html
        assert CUSTOMER_NAME not in content
        assert CUSTOMER_PHONE not in content
        assert CUSTOMER_EMAIL not in content


async def test_the_link_sent_by_email_opens_the_appointment(
    client: AsyncClient,
    session_factory: SessionFactory,
    sender: FakeSender,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await drain(session_factory)
    booked, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )

    assert await run_once(session_factory, sender, worker_now()) == 1

    [sent] = sender.sent
    url = f"https://app.test/agendamento/{token}"
    assert sent.message.to_email == CUSTOMER_EMAIL
    assert url in sent.message.text
    assert f'href="{url}"' in sent.message.html
    # The time in the business time zone, as the customer booked it.
    local = monday_10.astimezone(
        datetime.fromisoformat(booked.json()["starts_at"]).tzinfo
    )
    assert f"{local:%d/%m/%Y} às {local:%H:%M}" in sent.message.text
    link = await get_link(client, url.rsplit("/", maxsplit=1)[-1])
    assert link.status_code == 200
    assert link.json()["id"] == booked.json()["id"]
    assert_no_customer_data(sender)


async def test_every_appointment_email_is_rendered_and_sent(
    client: AsyncClient,
    owner_token: str,
    session_factory: SessionFactory,
    sender: FakeSender,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """Customer link and team: confirmation, reschedule and cancellation."""
    await drain(session_factory)
    _, token = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    rescheduled = await reschedule_link(client, token, monday_10 + timedelta(hours=1))
    assert rescheduled.status_code == 200, rescheduled.text
    assert (await cancel_link(client, token)).status_code == 200
    created = await create_manual(
        client,
        owner_token,
        pro.professional_id,
        service["id"],
        monday_10 + timedelta(hours=3),
        email="outro-cliente@example.com",
    )
    moved = await staff_reschedule(
        client, owner_token, created["id"], monday_10 + timedelta(hours=4)
    )
    assert moved.status_code == 200, moved.text
    assert (await act(client, owner_token, created["id"], "cancel")).status_code == 200

    assert await run_once(session_factory, sender, worker_now()) == 6

    subjects = [item.message.subject.split(" em ")[0] for item in sender.sent]
    assert subjects == [
        "Agendamento confirmado",
        "Agendamento remarcado",
        "Agendamento cancelado",
        "Agendamento confirmado",
        "Agendamento remarcado",
        "Agendamento cancelado",
    ]
    # The customer's reschedule brings the link; the team's says it still works.
    assert f"/agendamento/{token}" in sender.sent[1].message.text
    assert "continua valendo" in sender.sent[4].message.text
    assert "/agendamento/" not in sender.sent[4].message.text
    assert_no_customer_data(sender)


async def test_ct09_a_failed_delivery_keeps_the_appointment(
    client: AsyncClient,
    db: AsyncSession,
    session_factory: SessionFactory,
    sender: FakeSender,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await drain(session_factory)
    booked, token = await book(client, service["id"], monday_10)
    sender.fail_next(FailureKind.PERMANENT)

    assert await run_once(session_factory, sender, worker_now()) == 1

    [message] = [
        item
        for item in await all_messages(db)
        if item.template == EmailTemplate.APPOINTMENT_CONFIRMATION
    ]
    assert message.status is EmailOutboxStatus.FAILED
    assert message.last_error == "FakeDeliveryError 422"
    assert message.payload is None
    appointment = await get_appointment(db, booked.json()["id"])
    assert appointment.status is AppointmentStatus.CONFIRMED
    # The link shown on the screen still works.
    assert (await get_link(client, token)).status_code == 200


@mark.parametrize(
    ("template", "ttl", "path"),
    [
        (EmailTemplate.ACCOUNT_INVITE, INVITE_TTL, "/convite/"),
        (EmailTemplate.PASSWORD_RESET, PASSWORD_RESET_TTL, "/recuperar-senha/"),
    ],
)
async def test_d37_account_emails_show_the_expiry_in_the_business_time_zone(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    session_factory: SessionFactory,
    sender: FakeSender,
    template: EmailTemplate,
    ttl: timedelta,
    path: str,
) -> None:
    await drain(session_factory)
    if template is EmailTemplate.ACCOUNT_INVITE:
        response = await invite(client, owner_token, "nova@example.com")
        recipient = "nova@example.com"
    else:
        response = await client.post(
            f"{API}/auth/password/forgot", json={"email": OWNER_EMAIL}
        )
        recipient = OWNER_EMAIL
    assert response.status_code == 202, response.text
    expires_at = (clock.now + ttl).astimezone(BUSINESS_TIME_ZONE)
    [queued] = [item for item in await all_messages(db) if item.template == template]
    assert queued.payload is not None
    # The offset of the business, like the appointments, never UTC.
    assert queued.payload["expires_at"] == expires_at.isoformat()
    assert queued.payload["expires_at"].endswith("-03:00")

    assert await run_once(session_factory, sender, worker_now()) == 1

    [sent] = sender.sent
    assert sent.message.to_email == recipient
    assert f"https://app.test{path}" in sent.message.text
    assert f"{expires_at:%d/%m/%Y} às {expires_at:%H:%M}" in sent.message.text
    assert "UTC" not in sent.message.text
    assert "UTC" not in sent.message.html
