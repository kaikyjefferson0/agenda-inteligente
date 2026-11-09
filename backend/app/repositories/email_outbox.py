"""D38 and D39: reserving, finishing and retrying the messages of the outbox.

Every status other than pending erases the payload in the same write, as the
CHECK finished_requires_no_payload demands, because it may hold a raw token.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import ColumnElement, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailOutbox, EmailOutboxStatus


async def claim_due(
    session: AsyncSession, now: datetime, limit: int
) -> list[EmailOutbox]:
    """Locks the due messages that no other worker holds."""
    rows = await session.scalars(
        select(EmailOutbox)
        .where(
            EmailOutbox.status == EmailOutboxStatus.PENDING,
            EmailOutbox.next_attempt_at <= now,
        )
        .order_by(EmailOutbox.next_attempt_at, EmailOutbox.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(rows)


def reserve(message: EmailOutbox, until: datetime) -> None:
    """Counts the attempt and hides it until `until`, in the claiming transaction."""
    message.attempts += 1
    message.next_attempt_at = until


def expire(message: EmailOutbox, error: str) -> None:
    message.status = EmailOutboxStatus.FAILED
    message.payload = None
    message.last_error = error


def _of_reservation(message_id: UUID, attempts: int) -> tuple[ColumnElement[bool], ...]:
    """Only the reservation that sent it writes the result.

    A worker slower than its reservation finds the attempt counted again by
    another one, and its late result changes nothing.
    """
    return (
        EmailOutbox.id == message_id,
        EmailOutbox.status == EmailOutboxStatus.PENDING,
        EmailOutbox.attempts == attempts,
    )


async def _apply(
    session: AsyncSession, message_id: UUID, attempts: int, **values: object
) -> bool:
    result = await session.execute(
        update(EmailOutbox)
        .where(*_of_reservation(message_id, attempts))
        .values(**values)
        .returning(EmailOutbox.id)
    )
    return result.scalar_one_or_none() is not None


async def mark_sent(
    session: AsyncSession, message_id: UUID, attempts: int, now: datetime
) -> bool:
    return await _apply(
        session,
        message_id,
        attempts,
        status=EmailOutboxStatus.SENT,
        payload=None,
        sent_at=now,
        last_error=None,
    )


async def mark_retry(
    session: AsyncSession,
    message_id: UUID,
    attempts: int,
    next_attempt_at: datetime,
    error: str,
) -> bool:
    return await _apply(
        session,
        message_id,
        attempts,
        next_attempt_at=next_attempt_at,
        last_error=error,
    )


async def mark_failed(
    session: AsyncSession, message_id: UUID, attempts: int, error: str
) -> bool:
    return await _apply(
        session,
        message_id,
        attempts,
        status=EmailOutboxStatus.FAILED,
        payload=None,
        last_error=error,
    )
