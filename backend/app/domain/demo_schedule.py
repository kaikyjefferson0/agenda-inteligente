"""D43: the demo's time block and appointments, planned from the local date alone.

Nothing here is random: the same day always gives the same plan, so restoring
twice in a day recreates the same rows (D42, D45).

Each appointment is followed, inside the same working hours interval, by free
time where the professional's longest service fits. So a professional's day is
never more than half booked, and the public page always has free times for
every service (D43).
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.domain.availability import BusyPeriod, overlaps_any
from app.domain.schedule import WeeklyInterval, fits_working_hours

PAST_DAYS = 7
# Today counts as the first of them: the restoration runs at 03:00.
FUTURE_DAYS = 7
# The time block falls on the first working day from this one on.
TIME_BLOCK_DAYS_AHEAD = 2
# The first appointment of an interval starts 0, 1 or 2 steps after its start.
START_SHIFTS = 3

DemoStatus = Literal["confirmed", "completed", "no_show", "cancelled"]
# D43: mostly completed in the past, with some no-shows and cancellations.
PAST_STATUSES: tuple[DemoStatus, ...] = (
    "completed",
    "completed",
    "no_show",
    "completed",
    "cancelled",
    "completed",
)


@dataclass(frozen=True)
class DemoService:
    key: str
    duration_minutes: int
    preparation_minutes: int

    @property
    def block_minutes(self) -> int:
        return self.duration_minutes + self.preparation_minutes


@dataclass(frozen=True)
class DemoProfessional:
    key: str
    intervals: Sequence[WeeklyInterval]
    services: Sequence[DemoService]


@dataclass(frozen=True)
class PlannedTimeBlock:
    professional_key: str
    starts_at: datetime
    ends_at: datetime


@dataclass(frozen=True)
class PlannedAppointment:
    """`key` is unique and stable for the same day, so it can derive an id."""

    key: str
    professional_key: str
    service: DemoService
    starts_at: datetime
    ends_at: datetime
    blocked_until: datetime
    status: DemoStatus


def demo_days(today: date) -> list[date]:
    """The last 7 days, then today and the 6 days after it."""
    return [today + timedelta(days=offset) for offset in range(-PAST_DAYS, FUTURE_DAYS)]


def _intervals_of(professional: DemoProfessional, day: date) -> list[WeeklyInterval]:
    same_day = [i for i in professional.intervals if i.weekday == day.weekday()]
    return sorted(same_day, key=lambda interval: interval.start_time)


def _instant(day: date, at: time, timezone: ZoneInfo) -> datetime:
    return datetime.combine(day, at, tzinfo=timezone).astimezone(UTC)


def plan_time_block(
    today: date, professional: DemoProfessional, timezone: ZoneInfo
) -> PlannedTimeBlock | None:
    """The last interval of the professional's first working day from today + 2.

    Tomorrow stays free of it, and None means no working day in the window.
    """
    for offset in range(TIME_BLOCK_DAYS_AHEAD, FUTURE_DAYS):
        day = today + timedelta(days=offset)
        intervals = _intervals_of(professional, day)
        if intervals:
            last = intervals[-1]
            return PlannedTimeBlock(
                professional.key,
                _instant(day, last.start_time, timezone),
                _instant(day, last.end_time, timezone),
            )
    return None


def _round_up(minutes: int, step_minutes: int) -> int:
    return -(-minutes // step_minutes) * step_minutes


def _starts_in_interval(
    day: date,
    interval: WeeklyInterval,
    shift: int,
    services: Sequence[DemoService],
    step_minutes: int,
) -> Iterator[tuple[datetime, DemoService]]:
    """Local start times, each followed by room for the longest service.

    The gap starts on the grid and lasts the longest block, so any service of
    the professional fits right after any appointment, and no block takes more
    than half of its share of the interval. Every start is on the grid (RN02),
    because the interval starts on it and every move is a multiple of the step.
    """
    longest = max(service.block_minutes for service in services)
    gap = timedelta(minutes=_round_up(longest, step_minutes))
    cursor = datetime.combine(day, interval.start_time) + timedelta(
        minutes=shift * step_minutes
    )
    end = datetime.combine(day, interval.end_time)
    index = shift
    while True:
        service = services[index % len(services)]
        block = timedelta(minutes=_round_up(service.block_minutes, step_minutes))
        if cursor + block + gap > end:
            return
        yield cursor, service
        cursor += block + gap
        index += 1


def _status(day: date, today: date, sequence: int) -> DemoStatus:
    if day >= today:
        return "confirmed"
    return PAST_STATUSES[(day.toordinal() + sequence) % len(PAST_STATUSES)]


def plan_appointments(
    today: date,
    professionals: Sequence[DemoProfessional],
    timezone: ZoneInfo,
    *,
    step_minutes: int,
    time_blocks: Sequence[PlannedTimeBlock] = (),
) -> list[PlannedAppointment]:
    """D43: the appointments of every demo day, ordered by day and professional.

    An interval that touches a time block is left empty. In a zone with clock
    changes, a skipped local time is left out (RN06), and every block is checked
    against the working hours minute by minute (RN03, D16).
    """
    planned: list[PlannedAppointment] = []
    for day in demo_days(today):
        for position, professional in enumerate(professionals):
            blocked = [
                BusyPeriod(block.starts_at, block.ends_at)
                for block in time_blocks
                if block.professional_key == professional.key
            ]
            planned.extend(
                _plan_day(
                    day,
                    today,
                    position,
                    professional,
                    timezone,
                    step_minutes,
                    blocked,
                )
            )
    return planned


def _to_instant(local: datetime, timezone: ZoneInfo) -> datetime | None:
    """RN06: None for a skipped local time, the first occurrence for a repeated one."""
    instant = local.replace(tzinfo=timezone, fold=0).astimezone(UTC)
    if instant.astimezone(timezone).replace(tzinfo=None) != local:
        return None
    return instant


def _plan_day(
    day: date,
    today: date,
    position: int,
    professional: DemoProfessional,
    timezone: ZoneInfo,
    step_minutes: int,
    blocked: Sequence[BusyPeriod],
) -> Iterator[PlannedAppointment]:
    intervals = _intervals_of(professional, day)
    sequence = 0
    for number, interval in enumerate(intervals):
        interval_start = _instant(day, interval.start_time, timezone)
        interval_end = _instant(day, interval.end_time, timezone)
        if overlaps_any(interval_start, interval_end, blocked):
            continue
        # Varies the first start from day to day and between professionals.
        shift = (day.toordinal() + position + number) % START_SHIFTS
        for local, service in _starts_in_interval(
            day, interval, shift, professional.services, step_minutes
        ):
            starts_at = _to_instant(local, timezone)
            if starts_at is None:
                continue
            blocked_until = starts_at + timedelta(minutes=service.block_minutes)
            if not fits_working_hours(starts_at, blocked_until, intervals, timezone):
                continue
            yield PlannedAppointment(
                key=f"{day.isoformat()}/{professional.key}/{sequence}",
                professional_key=professional.key,
                service=service,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(minutes=service.duration_minutes),
                blocked_until=blocked_until,
                status=_status(day, today, sequence),
            )
            sequence += 1
