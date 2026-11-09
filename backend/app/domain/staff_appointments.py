from collections.abc import Iterable
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.domain.errors import ErrorCode
from app.domain.schedule import WeeklyInterval, fits_working_hours

# D25: 31 × 24 hours exactly, the limit included.
MAX_AGENDA_PERIOD = timedelta(days=31)


def agenda_period_error(starts_at: datetime, ends_at: datetime) -> str | None:
    """D25: the half-open period [from, to). None means valid."""
    if ends_at <= starts_at:
        return "to must be after from"
    if ends_at - starts_at > MAX_AGENDA_PERIOD:
        return "the period must not exceed 31 days"
    return None


def is_whole_minute(instant: datetime) -> bool:
    """D28: the team picks any minute, but never seconds or fractions of one."""
    return instant.second == 0 and instant.microsecond == 0


def block_end(
    starts_at: datetime, duration_minutes: int, preparation_minutes: int
) -> datetime | None:
    """RN03: the end of the block, preparation included. None past the calendar."""
    try:
        return starts_at + timedelta(minutes=duration_minutes + preparation_minutes)
    except OverflowError:
        return None


def fits_staff_hours(
    starts_at: datetime,
    blocked_until: datetime,
    intervals: Iterable[WeeklyInterval],
    timezone: ZoneInfo,
    now: datetime,
) -> bool:
    """RN19: not in the past, and the whole block in a single interval (RN03).

    Neither the grid nor the advance limits apply. Conflicts (RN04) are checked
    apart, against the busy periods.
    """
    if starts_at < now:
        return False
    try:
        return fits_working_hours(starts_at, blocked_until, intervals, timezone)
    except OverflowError:  # No working hours reach the end of the calendar.
        return False


def staff_change_refusal(*, is_confirmed: bool) -> ErrorCode | None:
    """RN20: cancelling and rescheduling ignore the deadline, never the status.

    None means allowed. Every final status is refused (RN15), so cancelling
    twice is refused too, even after the start.
    """
    if not is_confirmed:
        return ErrorCode.INVALID_STATUS_TRANSITION
    return None


def outcome_refusal(
    *, is_confirmed: bool, starts_at: datetime, now: datetime
) -> ErrorCode | None:
    """D32: completed and no-show only from the start on, the exact start included."""
    if not is_confirmed or now < starts_at:
        return ErrorCode.INVALID_STATUS_TRANSITION
    return None
