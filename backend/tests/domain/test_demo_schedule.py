"""D43: the plan of the demo, with no database and the date as the only input."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pytest import mark

from app.domain.availability import BookingRules, BusyPeriod, available_slots
from app.domain.demo_schedule import (
    FUTURE_DAYS,
    PAST_DAYS,
    DemoProfessional,
    DemoService,
    PlannedAppointment,
    PlannedTimeBlock,
    demo_days,
    plan_appointments,
    plan_time_block,
)
from app.domain.schedule import fits_working_hours

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
NEW_YORK = ZoneInfo("America/New_York")
STEP = 15
# Monday, 2030-03-04: the seven parametrized days cover every weekday.
MONDAY = date(2030, 3, 4)
EVERY_WEEKDAY = [MONDAY + timedelta(days=offset) for offset in range(7)]


@dataclass(frozen=True)
class Interval:
    weekday: int
    start_time: time
    end_time: time


HOURS = [
    Interval(weekday, start, end)
    for weekday in range(1, 6)
    for start, end in ((time(9), time(12)), (time(13), time(19)))
]
HAIRCUT = DemoService("haircut", 30, 10)
BEARD = DemoService("beard", 20, 5)
COMBO = DemoService("combo", 50, 15)
EYEBROWS = DemoService("eyebrows", 15, 0)
OWNER = DemoProfessional("owner", HOURS, [HAIRCUT, COMBO, EYEBROWS])
PRO = DemoProfessional("pro", HOURS, [HAIRCUT, BEARD, COMBO])


def plan(today: date) -> tuple[PlannedTimeBlock, list[PlannedAppointment]]:
    block = plan_time_block(today, PRO, SAO_PAULO)
    assert block is not None
    planned = plan_appointments(
        today, [OWNER, PRO], SAO_PAULO, step_minutes=STEP, time_blocks=[block]
    )
    return block, planned


def local_day(instant: datetime, timezone: ZoneInfo = SAO_PAULO) -> date:
    return instant.astimezone(timezone).date()


def working_minutes(day: date) -> int:
    return sum(
        (
            datetime.combine(day, interval.end_time)
            - datetime.combine(day, interval.start_time)
        )
        // timedelta(minutes=1)
        for interval in HOURS
        if interval.weekday == day.weekday()
    )


def test_the_days_are_the_last_seven_then_today_and_six_more() -> None:
    days = demo_days(MONDAY)

    assert len(days) == PAST_DAYS + FUTURE_DAYS
    assert days[0] == MONDAY - timedelta(days=7)
    assert days[PAST_DAYS] == MONDAY
    assert days[-1] == MONDAY + timedelta(days=6)


@mark.parametrize("today", EVERY_WEEKDAY)
def test_every_appointment_fits_the_working_hours(today: date) -> None:
    _, planned = plan(today)

    assert planned
    for appointment in planned:
        assert appointment.starts_at.tzinfo is UTC
        assert local_day(appointment.starts_at) in demo_days(today)
        assert fits_working_hours(
            appointment.starts_at, appointment.blocked_until, HOURS, SAO_PAULO
        )
        assert appointment.ends_at - appointment.starts_at == timedelta(
            minutes=appointment.service.duration_minutes
        )
        assert appointment.blocked_until - appointment.starts_at == timedelta(
            minutes=appointment.service.block_minutes
        )
        # RN02: the public page would offer the same start times.
        assert appointment.starts_at.astimezone(SAO_PAULO).minute % STEP == 0


@mark.parametrize("today", EVERY_WEEKDAY)
def test_no_professional_has_overlapping_blocks(today: date) -> None:
    block, planned = plan(today)
    by_professional: dict[str, list[PlannedAppointment]] = defaultdict(list)
    for appointment in planned:
        by_professional[appointment.professional_key].append(appointment)

    for professional, appointments in by_professional.items():
        ordered = sorted(appointments, key=lambda item: item.starts_at)
        for previous, following in zip(ordered, ordered[1:], strict=False):
            # Cancelled ones included, so the plan never depends on the status.
            assert previous.blocked_until <= following.starts_at
        if professional == block.professional_key:
            for appointment in appointments:
                assert not (
                    appointment.starts_at < block.ends_at
                    and block.starts_at < appointment.blocked_until
                )


@mark.parametrize("today", EVERY_WEEKDAY)
def test_every_future_day_is_at_most_half_booked(today: date) -> None:
    _, planned = plan(today)
    booked: dict[tuple[str, date], int] = defaultdict(int)
    for appointment in planned:
        day = local_day(appointment.starts_at)
        if day >= today:
            booked[appointment.professional_key, day] += (
                appointment.service.block_minutes
            )

    assert booked
    for (_, day), minutes in booked.items():
        assert minutes * 2 <= working_minutes(day)


@mark.parametrize("today", EVERY_WEEKDAY)
def test_every_future_working_day_has_free_times_for_every_service(
    today: date,
) -> None:
    block, planned = plan(today)
    rules = BookingRules(SAO_PAULO, STEP, min_advance_minutes=0, max_advance_days=30)
    now = datetime.combine(today, time(3), tzinfo=SAO_PAULO).astimezone(UTC)

    for professional in (OWNER, PRO):
        busy = [
            BusyPeriod(item.starts_at, item.blocked_until)
            for item in planned
            if item.professional_key == professional.key and item.status != "cancelled"
        ]
        if professional.key == block.professional_key:
            busy.append(BusyPeriod(block.starts_at, block.ends_at))
        for offset in range(FUTURE_DAYS):
            day = today + timedelta(days=offset)
            if not working_minutes(day):
                continue
            for service in professional.services:
                assert available_slots(
                    day,
                    rules=rules,
                    intervals=HOURS,
                    busy=busy,
                    duration_minutes=service.duration_minutes,
                    preparation_minutes=service.preparation_minutes,
                    now=now,
                )


@mark.parametrize("today", EVERY_WEEKDAY)
def test_past_days_have_final_statuses_and_future_days_are_confirmed(
    today: date,
) -> None:
    _, planned = plan(today)
    past = {item.status for item in planned if local_day(item.starts_at) < today}
    future = {item.status for item in planned if local_day(item.starts_at) >= today}

    assert past == {"completed", "no_show", "cancelled"}
    assert future == {"confirmed"}


@mark.parametrize("today", EVERY_WEEKDAY)
def test_the_same_day_gives_the_same_plan(today: date) -> None:
    first = plan(today)
    second = plan(today)

    assert first == second
    keys = [item.key for item in first[1]]
    assert len(keys) == len(set(keys))


def test_another_day_gives_another_plan() -> None:
    assert plan(MONDAY)[1] != plan(MONDAY + timedelta(days=1))[1]


@mark.parametrize("today", EVERY_WEEKDAY)
def test_the_time_block_is_the_last_interval_of_a_later_working_day(
    today: date,
) -> None:
    block, _ = plan(today)
    local_start = block.starts_at.astimezone(SAO_PAULO)
    local_end = block.ends_at.astimezone(SAO_PAULO)

    assert today + timedelta(days=2) <= local_start.date() < today + timedelta(7)
    assert local_start.weekday() in range(1, 6)
    assert (local_start.time(), local_end.time()) == (time(13), time(19))
    assert block.professional_key == PRO.key


def test_no_time_block_without_working_days() -> None:
    idle = DemoProfessional("idle", [], [HAIRCUT])

    assert plan_time_block(MONDAY, idle, SAO_PAULO) is None
    assert plan_appointments(MONDAY, [idle], SAO_PAULO, step_minutes=STEP) == []


def plan_clock_change_day(
    sunday: date, hours: list[Interval], service: DemoService
) -> list[PlannedAppointment]:
    """Three professionals, so the three start shifts are all tried."""
    professionals = [DemoProfessional(f"p{n}", hours, [service]) for n in range(3)]
    planned = plan_appointments(sunday, professionals, NEW_YORK, step_minutes=STEP)
    on_the_day = [
        item for item in planned if local_day(item.starts_at, NEW_YORK) == sunday
    ]
    for item in on_the_day:
        assert fits_working_hours(item.starts_at, item.blocked_until, hours, NEW_YORK)
    return on_the_day


def test_a_skipped_local_time_is_left_out() -> None:
    """RN06: 02:00 to 03:00 does not exist in New York on 2030-03-10."""
    sunday = date(2030, 3, 10)
    hours = [Interval(6, time(1), time(4))]

    planned = plan_clock_change_day(sunday, hours, DemoService("s", 30, 0))

    local_hours = {item.starts_at.astimezone(NEW_YORK).hour for item in planned}
    assert local_hours == {1, 3}


def test_a_block_leaving_the_interval_in_a_repeated_hour_is_left_out() -> None:
    """D16: on 2030-11-03, New York goes from 01:59 back to 01:00.

    From 01:30 or 01:45, 45 minutes pass through 01:00, outside the interval.
    """
    sunday = date(2030, 11, 3)
    hours = [Interval(6, time(1, 30), time(4))]

    planned = plan_clock_change_day(sunday, hours, DemoService("s", 45, 0))

    starts = [item.starts_at.astimezone(NEW_YORK) for item in planned]
    assert starts
    assert all((local.hour, local.fold) != (1, 0) for local in starts)
