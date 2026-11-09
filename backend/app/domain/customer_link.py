import re
from datetime import datetime, timedelta

from app.domain.errors import ErrorCode

# RN16
LINK_TTL = timedelta(days=30)

# The alphabet of the tokens the system issues. Anything else is never hashed
# and answers like an unknown token.
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}")


def is_token_well_formed(token: str) -> bool:
    return TOKEN_PATTERN.fullmatch(token) is not None


def is_link_expired(starts_at: datetime, now: datetime) -> bool:
    """RN16: the link works until 30 days after the start, the limit included."""
    return now > starts_at + LINK_TTL


def change_deadline_at(starts_at: datetime, change_deadline_minutes: int) -> datetime:
    return starts_at - timedelta(minutes=change_deadline_minutes)


def is_within_change_deadline(
    starts_at: datetime, change_deadline_minutes: int, now: datetime
) -> bool:
    """RN17: `now <= start - deadline`, so the exact limit is allowed."""
    return now <= change_deadline_at(starts_at, change_deadline_minutes)


def change_refusal(
    *,
    is_confirmed: bool,
    starts_at: datetime,
    change_deadline_minutes: int,
    now: datetime,
) -> ErrorCode | None:
    """D19: the status comes first, then the deadline. None means allowed.

    Every final status is refused (RN15), so cancelling twice is refused too.
    """
    if not is_confirmed:
        return ErrorCode.INVALID_STATUS_TRANSITION
    if not is_within_change_deadline(starts_at, change_deadline_minutes, now):
        return ErrorCode.CHANGE_DEADLINE_PASSED
    return None


def can_cancel(
    *,
    is_confirmed: bool,
    starts_at: datetime,
    change_deadline_minutes: int,
    now: datetime,
) -> bool:
    """D21: confirmed and within the deadline."""
    return (
        change_refusal(
            is_confirmed=is_confirmed,
            starts_at=starts_at,
            change_deadline_minutes=change_deadline_minutes,
            now=now,
        )
        is None
    )


def can_reschedule(
    *,
    is_confirmed: bool,
    starts_at: datetime,
    change_deadline_minutes: int,
    service_is_active: bool,
    now: datetime,
) -> bool:
    """D21: as cancelling, and the service must still be active."""
    return service_is_active and can_cancel(
        is_confirmed=is_confirmed,
        starts_at=starts_at,
        change_deadline_minutes=change_deadline_minutes,
        now=now,
    )
