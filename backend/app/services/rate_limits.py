from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import rate_limit_key
from app.domain.errors import AppError, ErrorCode
from app.domain.rate_limits import (
    ONE_DAY,
    RateLimit,
    seconds_until_window_end,
    window_start,
)
from app.repositories import rate_limits as counters

EMAIL_RECIPIENT_COUNTER = "email_recipient"
EMAIL_GLOBAL_COUNTER = "email_global"


async def enforce_rate_limit(
    session: AsyncSession,
    settings: Settings,
    limit: RateLimit,
    subject: str,
    now: datetime,
) -> None:
    """Counts one attempt and refuses it above the limit.

    Commits on its own: a failed login rolls back its transaction, which would
    otherwise erase the attempt being counted. Call it before the operation.
    """
    key = rate_limit_key(settings.rate_limit_key_secret, limit.name, subject)
    count = await counters.increment(session, key, window_start(now, limit.window))
    await session.commit()
    if count > limit.max_requests:
        raise AppError(
            ErrorCode.RATE_LIMITED,
            retry_after=seconds_until_window_end(now, limit.window),
        )


async def consume_email_quota(
    session: AsyncSession, settings: Settings, recipient: str, now: datetime
) -> bool:
    """Reserves one e-mail in the caller's transaction (RN26).

    Rolling the operation back also returns the quota, since nothing was sent.
    The recipient comes first, so a refused recipient does not spend the global
    cap, and the fixed order prevents deadlocks.
    """
    day = window_start(now, ONE_DAY)
    secret = settings.rate_limit_key_secret
    recipient_key = rate_limit_key(
        secret, EMAIL_RECIPIENT_COUNTER, recipient.casefold()
    )
    recipient_count = await counters.increment(session, recipient_key, day)
    if recipient_count > settings.email_recipient_daily_cap:
        return False
    global_key = rate_limit_key(secret, EMAIL_GLOBAL_COUNTER, "all")
    global_count = await counters.increment(session, global_key, day)
    return global_count <= settings.email_daily_cap


def seconds_until_email_quota_resets(now: datetime) -> int:
    return seconds_until_window_end(now, ONE_DAY)
