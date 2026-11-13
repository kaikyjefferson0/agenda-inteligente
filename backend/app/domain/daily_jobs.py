"""D106 and D115: when the daily jobs are due and what the cleanup keeps.

Pure functions; the tasks that call them live in `app/jobs/`.
"""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.domain.rate_limits import ONE_DAY

# D106: the demo of a day is restored from this local hour on.
RESTORE_AFTER = time(3, 0)
# D115: the longest window of any counter (the daily e-mail caps, D36). A test
# checks that every limit fits in it.
LONGEST_COUNTER_WINDOW = ONE_DAY
# D115: how long a finished window and a finished message are kept.
COUNTER_RETENTION = ONE_DAY
EMAIL_RETENTION = timedelta(days=30)


def restoration_due(
    restored_at: datetime | None, now: datetime, timezone: ZoneInfo
) -> bool:
    """D106: no demo yet, or the demo is of an earlier day and it is past 03:00.

    `restored_at` is the `created_at` of the demo business, which every
    restoration writes again. Both dates are taken in the demo's time zone.
    """
    if restored_at is None:
        return True
    local_now = now.astimezone(timezone)
    if local_now.time() < RESTORE_AFTER:
        return False
    return restored_at.astimezone(timezone).date() < local_now.date()


def counter_cutoff(now: datetime) -> datetime:
    """D115: windows that started before this ended over a day ago.

    The window length is not stored, so the longest one is assumed: a shorter
    window that started at the same time ended even earlier.
    """
    return now - LONGEST_COUNTER_WINDOW - COUNTER_RETENTION


def email_cutoff(now: datetime) -> datetime:
    """D115: `sent` and `failed` messages created before this are deleted."""
    return now - EMAIL_RETENTION
