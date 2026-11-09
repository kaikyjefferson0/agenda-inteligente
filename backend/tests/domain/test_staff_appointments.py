from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pytest import mark

from app.domain.availability import BusyPeriod, overlaps_any
from app.domain.errors import ErrorCode
from app.domain.staff_appointments import (
    MAX_AGENDA_PERIOD,
    agenda_period_error,
    block_end,
    fits_staff_hours,
    is_whole_minute,
    outcome_refusal,
    staff_change_refusal,
)

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
KIRITIMATI = ZoneInfo("Pacific/Kiritimati")
FROM = datetime(2030, 3, 4, 3, 0, tzinfo=UTC)
# Monday, 2030-03-04, 10:00 in São Paulo.
STARTS_AT = datetime(2030, 3, 4, 13, 0, tzinfo=UTC)
ONE_MICROSECOND = timedelta(microseconds=1)
ONE_SECOND = timedelta(seconds=1)


@dataclass(frozen=True)
class Interval:
    weekday: int
    start_time: time
    end_time: time


MONDAY_HOURS = [Interval(0, time(9), time(12)), Interval(0, time(13), time(18))]


# D25


def test_a_period_of_exactly_31_days_is_accepted() -> None:
    assert MAX_AGENDA_PERIOD == timedelta(hours=31 * 24)
    assert agenda_period_error(FROM, FROM + MAX_AGENDA_PERIOD) is None


def test_a_period_one_microsecond_above_31_days_is_refused() -> None:
    error = agenda_period_error(FROM, FROM + MAX_AGENDA_PERIOD + ONE_MICROSECOND)
    assert error == "the period must not exceed 31 days"


@mark.parametrize("to", [FROM, FROM - ONE_SECOND], ids=["equal", "before"])
def test_to_must_be_after_from(to: datetime) -> None:
    assert agenda_period_error(FROM, to) == "to must be after from"


def test_the_shortest_period_is_accepted() -> None:
    assert agenda_period_error(FROM, FROM + ONE_MICROSECOND) is None


# D28


@mark.parametrize(
    ("instant", "whole"),
    [
        (STARTS_AT, True),
        (STARTS_AT + timedelta(minutes=7), True),
        (STARTS_AT + ONE_SECOND, False),
        (STARTS_AT + ONE_MICROSECOND, False),
    ],
    ids=["round", "any_minute", "seconds", "microseconds"],
)
def test_the_team_books_any_whole_minute(instant: datetime, whole: bool) -> None:
    assert is_whole_minute(instant) is whole


def test_the_block_ends_after_the_duration_and_the_preparation() -> None:
    assert block_end(STARTS_AT, 30, 10) == STARTS_AT + timedelta(minutes=40)


def test_a_block_past_the_calendar_has_no_end() -> None:
    assert block_end(datetime.max.replace(tzinfo=UTC), 30, 0) is None


# RN19


def fits(starts_at: datetime, minutes: int = 30, *, now: datetime = FROM) -> bool:
    return fits_staff_hours(
        starts_at,
        starts_at + timedelta(minutes=minutes),
        MONDAY_HOURS,
        SAO_PAULO,
        now,
    )


def test_off_the_grid_and_far_ahead_is_accepted() -> None:
    assert fits(STARTS_AT + timedelta(minutes=7))
    assert fits(STARTS_AT + timedelta(days=364 * 7), now=FROM - timedelta(days=1))


def test_the_whole_block_must_fit_a_single_interval() -> None:
    noon = datetime(2030, 3, 4, 15, 0, tzinfo=UTC)
    assert fits(noon - timedelta(minutes=30))
    assert not fits(noon - timedelta(minutes=20))
    assert not fits(noon + timedelta(minutes=30))


def test_the_past_is_refused_and_the_present_is_accepted() -> None:
    assert fits(STARTS_AT, now=STARTS_AT)
    assert not fits(STARTS_AT, now=STARTS_AT + ONE_SECOND)


def test_a_time_beyond_the_local_calendar_never_fits() -> None:
    last = datetime.max.replace(tzinfo=UTC) - timedelta(hours=1)
    hours = [Interval(weekday, time(0), time(23, 59)) for weekday in range(7)]
    assert not fits_staff_hours(
        last, last + timedelta(minutes=30), hours, KIRITIMATI, FROM
    )


def test_conflicts_use_half_open_periods() -> None:
    busy = [BusyPeriod(STARTS_AT, STARTS_AT + timedelta(minutes=30))]
    later = STARTS_AT + timedelta(minutes=30)
    assert not overlaps_any(later, later + timedelta(minutes=30), busy)
    assert overlaps_any(later - ONE_SECOND, later + timedelta(minutes=30), busy)
    assert not overlaps_any(STARTS_AT - timedelta(hours=1), STARTS_AT, busy)


# RN20 and D32


def test_the_team_changes_only_confirmed_appointments() -> None:
    assert staff_change_refusal(is_confirmed=True) is None
    assert (
        staff_change_refusal(is_confirmed=False) is ErrorCode.INVALID_STATUS_TRANSITION
    )


@mark.parametrize(
    ("now", "allowed"),
    [
        (STARTS_AT - timedelta(hours=1), False),
        (STARTS_AT - ONE_MICROSECOND, False),
        (STARTS_AT, True),
        (STARTS_AT + timedelta(days=60), True),
    ],
    ids=["well_before", "just_before", "exact_start", "long_after"],
)
def test_ct34_the_outcome_is_recorded_from_the_exact_start(
    now: datetime, allowed: bool
) -> None:
    refusal = outcome_refusal(is_confirmed=True, starts_at=STARTS_AT, now=now)
    assert (refusal is None) is allowed
    if not allowed:
        assert refusal is ErrorCode.INVALID_STATUS_TRANSITION


def test_ct34_a_final_status_never_gets_an_outcome() -> None:
    refusal = outcome_refusal(
        is_confirmed=False, starts_at=STARTS_AT, now=STARTS_AT + timedelta(hours=1)
    )
    assert refusal is ErrorCode.INVALID_STATUS_TRANSITION
