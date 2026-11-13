"""D115: deletes the finished rate limit windows and the old finished e-mails.

Called by the e-mail worker once a day, wherever it runs (its own process in
development, inside the API in production), because every installation has
one and neither table may grow forever. On the demo, the daily restoration
also calls it right after committing.
"""

import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.daily_jobs import counter_cutoff, email_cutoff
from app.repositories import retention

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CleanupReport:
    counters: int
    emails: int


async def clean_up(
    session_factory: async_sessionmaker[AsyncSession], now: datetime
) -> CleanupReport:
    """One short transaction of its own, apart from any restoration."""
    async with session_factory() as session:
        counters = await retention.delete_counters_before(session, counter_cutoff(now))
        emails = await retention.delete_finished_emails_before(
            session, email_cutoff(now)
        )
        await session.commit()
    # Only counts, as in D40 and D49.
    logger.info(
        "cleanup deleted rate_limit_counters=%d email_outbox=%d", counters, emails
    )
    return CleanupReport(counters, emails)
