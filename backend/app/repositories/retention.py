"""D115: the deletions of the daily cleanup.

Neither table is referenced by another, and both deletions are idempotent, so
two processes cleaning at the same time only repeat each other's work.
"""

from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmailOutbox, EmailOutboxStatus, RateLimitCounter


async def delete_counters_before(session: AsyncSession, cutoff: datetime) -> int:
    result = await session.execute(
        delete(RateLimitCounter)
        .where(RateLimitCounter.window_start < cutoff)
        .returning(RateLimitCounter.key)
    )
    return len(result.all())


async def delete_finished_emails_before(session: AsyncSession, cutoff: datetime) -> int:
    """Never a pending message: it still has to be sent or expire (D39)."""
    result = await session.execute(
        delete(EmailOutbox)
        .where(
            EmailOutbox.status.in_([EmailOutboxStatus.SENT, EmailOutboxStatus.FAILED]),
            EmailOutbox.created_at < cutoff,
        )
        .returning(EmailOutbox.id)
    )
    return len(result.all())
