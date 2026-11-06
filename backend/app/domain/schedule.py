from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

ONE_MINUTE = timedelta(minutes=1)


class WeeklyInterval(Protocol):
    """A working hours interval, in the business's local time."""

    @property
    def weekday(self) -> int: ...

    @property
    def start_time(self) -> time: ...

    @property
    def end_time(self) -> time: ...


@dataclass(frozen=True)
class AppointmentSummary:
    """What the team sees of an appointment to resolve it, without contact data."""

    id: UUID
    professional_id: UUID
    service_id: UUID
    starts_at: datetime
    ends_at: datetime
    blocked_until: datetime
    status: str
    customer_name: str


def has_overlapping_intervals(intervals: Iterable[WeeklyInterval]) -> bool:
    """Intervals are half-open (RN04), so one may start where another ends."""
    by_weekday: dict[int, list[WeeklyInterval]] = defaultdict(list)
    for interval in intervals:
        by_weekday[interval.weekday].append(interval)
    for same_day in by_weekday.values():
        ordered = sorted(same_day, key=lambda interval: interval.start_time)
        for previous, following in zip(ordered, ordered[1:], strict=False):
            if following.start_time < previous.end_time:
                return True
    return False


def _block_fits_interval(
    start: datetime, end: datetime, interval: WeeklyInterval, timezone: ZoneInfo
) -> bool:
    if not interval.start_time <= start.time() < interval.end_time:
        return False
    start_offset, end_offset = start.utcoffset(), end.utcoffset()
    if start_offset is None or end_offset is None or end_offset >= start_offset:
        # A clock moving forward passes every time between both ends.
        return interval.start_time < end.time() <= interval.end_time

    # A clock going back can leave the interval and return, and a block may even
    # end at the very time the interval starts. Only the walk tells them apart.
    instant = start.astimezone(UTC) + ONE_MINUTE
    stop = end.astimezone(UTC)
    while instant < stop:
        clock = instant.astimezone(timezone).time()
        if not interval.start_time <= clock < interval.end_time:
            return False
        instant += ONE_MINUTE
    return True


def fits_working_hours(
    starts_at: datetime,
    blocked_until: datetime,
    intervals: Iterable[WeeklyInterval],
    timezone: ZoneInfo,
) -> bool:
    """RN03: the whole block, preparation included, fits in a single interval.

    The comparison uses the local clock (RN06), because that is how working hours
    are defined. It stays correct across a clock change: nothing happens during
    skipped hours, and in repeated hours the block must stay inside the interval
    the whole time, not only at both ends.
    """
    start = starts_at.astimezone(timezone)
    end = blocked_until.astimezone(timezone)
    # No interval crosses midnight, not even one that would end exactly at 00:00.
    if start.date() != end.date():
        return False
    return any(
        interval.weekday == start.weekday()
        and _block_fits_interval(start, end, interval, timezone)
        for interval in intervals
    )


def appointments_outside_hours(
    appointments: Iterable[AppointmentSummary],
    intervals_by_professional: Mapping[UUID, Sequence[WeeklyInterval]],
    timezone: ZoneInfo,
) -> list[AppointmentSummary]:
    """RN22: lists the appointments that no longer fit the working hours."""
    return [
        appointment
        for appointment in appointments
        if not fits_working_hours(
            appointment.starts_at,
            appointment.blocked_until,
            intervals_by_professional.get(appointment.professional_id, []),
            timezone,
        )
    ]
