from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.domain.schedule import WeeklyInterval, fits_working_hours

MINUTES_PER_HOUR = 60
MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR


@dataclass(frozen=True)
class BookingRules:
    """The settings of a business that decide which times are offered."""

    timezone: ZoneInfo
    slot_step_minutes: int
    min_advance_minutes: int
    max_advance_days: int

    def earliest(self, now: datetime) -> datetime:
        return now + timedelta(minutes=self.min_advance_minutes)

    def latest(self, now: datetime) -> datetime:
        return now + timedelta(days=self.max_advance_days)


@dataclass(frozen=True)
class BusyPeriod:
    """Half-open (RN04). For an appointment, it ends at blocked_until."""

    starts_at: datetime
    ends_at: datetime


def is_within_advance(instant: datetime, rules: BookingRules, now: datetime) -> bool:
    """RN05: both limits are inclusive."""
    return rules.earliest(now) <= instant <= rules.latest(now)


def is_day_within_advance(day: date, rules: BookingRules, now: datetime) -> bool:
    """Compares local days, so an extreme date never gets converted between zones."""
    first = rules.earliest(now).astimezone(rules.timezone).date()
    last = rules.latest(now).astimezone(rules.timezone).date()
    return first <= day <= last


def is_on_grid(instant: datetime, rules: BookingRules) -> bool:
    """RN02 and RN06: a multiple of the step, in the first occurrence of the hour."""
    local = instant.astimezone(rules.timezone)
    minutes = local.hour * MINUTES_PER_HOUR + local.minute
    return (
        minutes % rules.slot_step_minutes == 0
        and local.second == 0
        and local.microsecond == 0
        and local.fold == 0
    )


def local_day_bounds(day: date, timezone: ZoneInfo) -> tuple[datetime, datetime]:
    """The local day as a half-open period in UTC."""
    next_day = day + timedelta(days=1)
    return (
        datetime.combine(day, time.min, tzinfo=timezone).astimezone(UTC),
        datetime.combine(next_day, time.min, tzinfo=timezone).astimezone(UTC),
    )


def _local_grid(day: date, step_minutes: int) -> Iterator[datetime]:
    """RN02: multiples of the step on the local clock, counted from midnight."""
    for minutes in range(0, MINUTES_PER_DAY, step_minutes):
        hour, minute = divmod(minutes, MINUTES_PER_HOUR)
        yield datetime.combine(day, time(hour, minute))


def _to_instant(local: datetime, timezone: ZoneInfo) -> datetime | None:
    """RN06: None for a skipped local time, the first occurrence for a repeated one."""
    instant = local.replace(tzinfo=timezone, fold=0).astimezone(UTC)
    if instant.astimezone(timezone).replace(tzinfo=None) != local:
        return None
    return instant


def available_slots(
    day: date,
    *,
    rules: BookingRules,
    intervals: Iterable[WeeklyInterval],
    busy: Iterable[BusyPeriod],
    duration_minutes: int,
    preparation_minutes: int,
    now: datetime,
) -> list[datetime]:
    """The free start times of one professional on a local day, in UTC (RN01 to RN06).

    RN07 is applied by the caller, which only asks about eligible professionals.
    """
    if not is_day_within_advance(day, rules, now):
        return []

    block = timedelta(minutes=duration_minutes + preparation_minutes)
    working_hours = list(intervals)
    occupied = list(busy)
    slots: list[datetime] = []
    for local in _local_grid(day, rules.slot_step_minutes):
        starts_at = _to_instant(local, rules.timezone)
        if starts_at is None or not is_within_advance(starts_at, rules, now):
            continue
        blocked_until = starts_at + block
        if not fits_working_hours(
            starts_at, blocked_until, working_hours, rules.timezone
        ):
            continue
        if any(
            period.starts_at < blocked_until and starts_at < period.ends_at
            for period in occupied
        ):
            continue
        slots.append(starts_at)
    return slots
