from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.email.templates import EmailTemplate
from app.models import EmailOutbox

RECIPIENT = "cliente@example.com"
TOKEN = "token-bruto-de-teste-0123456789"
URL = f"https://app.test/agendamento/{TOKEN}"
CONFIRMATION_PAYLOAD: dict[str, Any] = {
    "url": URL,
    "business_name": "Barbearia",
    "service_name": "Corte",
    "professional_name": "Profissional",
    "starts_at": "2026-11-10T09:00:00-03:00",
}


def worker_now(offset: timedelta = timedelta()) -> datetime:
    """Ahead of the database clock, which stamps `created_at` and the first
    `next_attempt_at` of the rows created by the API."""
    return datetime.now(UTC) + timedelta(seconds=1) + offset


async def make_message(
    db: AsyncSession,
    *,
    template: str = EmailTemplate.APPOINTMENT_CONFIRMATION,
    payload: dict[str, Any] | None = None,
    to_email: str = RECIPIENT,
    created_at: datetime | None = None,
    next_attempt_at: datetime | None = None,
) -> EmailOutbox:
    message = EmailOutbox(
        to_email=to_email,
        template=template,
        payload=CONFIRMATION_PAYLOAD if payload is None else payload,
    )
    if created_at is not None:
        message.created_at = created_at
    if next_attempt_at is not None:
        message.next_attempt_at = next_attempt_at
    db.add(message)
    await db.commit()
    return message


async def get_message(db: AsyncSession, message_id: UUID) -> EmailOutbox:
    message = await db.scalar(
        select(EmailOutbox)
        .where(EmailOutbox.id == message_id)
        .execution_options(populate_existing=True)
    )
    assert message is not None
    return message


async def all_messages(db: AsyncSession) -> list[EmailOutbox]:
    rows = await db.scalars(
        select(EmailOutbox)
        .order_by(EmailOutbox.created_at, EmailOutbox.id)
        .execution_options(populate_existing=True)
    )
    return list(rows)
