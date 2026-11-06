from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, time
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo


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


def fits_working_hours(
    starts_at: datetime,
    blocked_until: datetime,
    intervals: Iterable[WeeklyInterval],
    timezone: ZoneInfo,
) -> bool:
    """RN03: the whole block, preparation included, fits in a single interval.

    The comparison uses the local clock (RN06), because that is how working hours
    are defined. It stays correct across a clock change: nothing happens during
    skipped hours, and a block in repeated hours is judged by what the clock shows.
    """
    start = starts_at.astimezone(timezone)
    end = blocked_until.astimezone(timezone)
    # No interval crosses midnight, not even one that would end exactly at 00:00.
    if start.date() != end.date():
        return False
    return any(
        interval.weekday == start.weekday()
        and interval.start_time <= start.time() < interval.end_time
        and interval.start_time < end.time() <= interval.end_time
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
