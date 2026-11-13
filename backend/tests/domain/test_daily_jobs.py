"""D106 and D115: when the demo is restored and what the daily cleanup keeps."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pytest import mark

from app.domain import rate_limits
from app.domain.daily_jobs import (
    LONGEST_COUNTER_WINDOW,
    counter_cutoff,
    email_cutoff,
    restoration_due,
)

ZONE = ZoneInfo("America/Sao_Paulo")


def local(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=ZONE)


def test_without_a_demo_it_is_always_due() -> None:
    # Before 03:00 too: no demo is worse than a demo of the day being made early.
    assert restoration_due(None, local(13, 1), ZONE)


@mark.parametrize(
    ("restored_at", "now", "due"),
    [
        # Yesterday's demo waits for 03:00.
        (local(12, 10), local(13, 2, 59), False),
        (local(12, 10), local(13, 3), True),
        (local(12, 23, 59), local(13, 15), True),
        # Several days old: due as well.
        (local(5, 10), local(13, 3, 1), True),
        # Already of today, even when restored before 03:00.
        (local(13, 0, 30), local(13, 3, 30), False),
        (local(13, 3), local(13, 23, 59), False),
    ],
)
def test_due_after_03_00_when_the_demo_is_of_an_earlier_day(
    restored_at: datetime, now: datetime, due: bool
) -> None:
    assert restoration_due(restored_at, now, ZONE) is due


def test_the_dates_are_taken_in_the_demo_time_zone() -> None:
    # 01:00 UTC on the 13th is still the 12th, 22:00, in São Paulo.
    restored_at = datetime(2026, 11, 13, 1, 0, tzinfo=UTC)
    assert not restoration_due(restored_at, local(12, 23), ZONE)
    assert restoration_due(restored_at, local(13, 3), ZONE)
    # And the clock is converted as well: 06:00 UTC is 03:00 in São Paulo.
    before = datetime(2026, 11, 13, 5, 59, tzinfo=UTC)
    after = datetime(2026, 11, 13, 6, 0, tzinfo=UTC)
    assert not restoration_due(local(12, 10), before, ZONE)
    assert restoration_due(local(12, 10), after, ZONE)


def test_counters_are_kept_a_day_after_the_longest_window_ends() -> None:
    now = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
    assert counter_cutoff(now) == now - timedelta(days=2)


def test_every_rate_limit_fits_in_the_longest_window() -> None:
    windows = [
        value.window
        for value in vars(rate_limits).values()
        if isinstance(value, rate_limits.RateLimit)
    ]
    assert windows  # The check finds the limits.
    assert max([*windows, rate_limits.ONE_DAY]) <= LONGEST_COUNTER_WINDOW


def test_finished_emails_are_kept_for_30_days() -> None:
    now = datetime(2026, 11, 13, 12, 0, tzinfo=UTC)
    assert email_cutoff(now) == now - timedelta(days=30)
