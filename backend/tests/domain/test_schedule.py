from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from pytest import mark

from app.domain.business import is_advance_window_valid
from app.domain.schedule import (
    AppointmentSummary,
    appointments_outside_hours,
    fits_working_hours,
    has_overlapping_intervals,
)

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
NEW_YORK = ZoneInfo("America/New_York")
# 2030-01-07 is a Monday, and São Paulo is at UTC-3.
MONDAY = 0


@dataclass(frozen=True)
class Interval:
    weekday: int
    start_time: time
    end_time: time


def interval(start: str, end: str, weekday: int = MONDAY) -> Interval:
    return Interval(weekday, time.fromisoformat(start), time.fromisoformat(end))


def sao_paulo(hour: int, minute: int = 0, day: int = 7) -> datetime:
    return datetime(2030, 1, day, hour, minute, tzinfo=SAO_PAULO)


def test_intervals_of_different_days_or_touching_do_not_overlap() -> None:
    assert not has_overlapping_intervals(
        [
            interval("09:00", "12:00"),
            interval("12:00", "18:00"),
            interval("09:00", "12:00", weekday=1),
        ]
    )


def test_overlapping_intervals_are_detected_in_any_order() -> None:
    assert has_overlapping_intervals(
        [interval("13:00", "18:00"), interval("09:00", "13:01")]
    )


def test_interval_inside_another_is_detected() -> None:
    assert has_overlapping_intervals(
        [
            interval("09:00", "18:00"),
            interval("10:00", "11:00"),
            interval("19:00", "20:00"),
        ]
    )


def test_block_fits_up_to_the_exact_limits_of_the_interval() -> None:
    assert fits_working_hours(
        sao_paulo(9), sao_paulo(18), [interval("09:00", "18:00")], SAO_PAULO
    )


@mark.parametrize(
    ("start", "end"),
    [
        (sao_paulo(8, 59), sao_paulo(10)),
        (sao_paulo(17), sao_paulo(18, 1)),
        (sao_paulo(7), sao_paulo(8)),
    ],
)
def test_block_past_the_limits_does_not_fit(start: datetime, end: datetime) -> None:
    assert not fits_working_hours(start, end, [interval("09:00", "18:00")], SAO_PAULO)


def test_block_must_fit_in_a_single_interval() -> None:
    intervals = [interval("09:00", "12:00"), interval("12:00", "18:00")]

    assert not fits_working_hours(sao_paulo(11), sao_paulo(13), intervals, SAO_PAULO)
    assert fits_working_hours(sao_paulo(13), sao_paulo(14), intervals, SAO_PAULO)


def test_interval_of_another_weekday_does_not_count() -> None:
    assert not fits_working_hours(
        sao_paulo(10), sao_paulo(11), [interval("09:00", "18:00", 1)], SAO_PAULO
    )


def test_weekday_is_the_local_one_not_the_utc_one() -> None:
    # Monday 22:00 in São Paulo is already Tuesday in UTC.
    start = datetime(2030, 1, 8, 1, 0, tzinfo=UTC)

    assert fits_working_hours(
        start, start + timedelta(hours=1), [interval("20:00", "23:30")], SAO_PAULO
    )


def test_block_crossing_midnight_does_not_fit() -> None:
    intervals = [interval("20:00", "23:59"), interval("00:00", "08:00", 1)]

    assert not fits_working_hours(
        sao_paulo(23, 30), sao_paulo(0, 30, day=8), intervals, SAO_PAULO
    )
    assert not fits_working_hours(
        sao_paulo(23, 30), sao_paulo(0, 0, day=8), intervals, SAO_PAULO
    )


def test_block_crossing_midnight_fails_even_with_both_times_inside_an_interval() -> (
    None
):
    # 23:30 and 00:30 are both within these intervals: only the date differs.
    whole_days = [interval("00:00", "23:59"), interval("00:00", "23:59", 1)]

    assert not fits_working_hours(
        sao_paulo(23, 30), sao_paulo(0, 30, day=8), whole_days, SAO_PAULO
    )


def test_no_intervals_means_nothing_fits() -> None:
    assert not fits_working_hours(sao_paulo(10), sao_paulo(11), [], SAO_PAULO)


# New York, 2030-03-10 (Sunday): the clock jumps from 02:00 to 03:00.
GAP_DAY = 6


def new_york_gap(hour: int, minute: int = 0) -> datetime:
    return datetime(2030, 3, 10, hour, minute, tzinfo=NEW_YORK)


def test_interval_starting_in_skipped_hours_begins_after_the_jump() -> None:
    intervals = [interval("02:30", "05:00", GAP_DAY)]

    assert fits_working_hours(new_york_gap(3), new_york_gap(4), intervals, NEW_YORK)
    assert not fits_working_hours(
        new_york_gap(1, 30), new_york_gap(3, 30), intervals, NEW_YORK
    )


def test_block_crossing_skipped_hours_is_judged_by_the_clock() -> None:
    start = new_york_gap(1, 50)
    # 20 elapsed minutes: the clock goes from 01:50 to 03:10.
    end = start.astimezone(UTC) + timedelta(minutes=20)

    assert fits_working_hours(
        start, end, [interval("01:00", "03:30", GAP_DAY)], NEW_YORK
    )
    assert not fits_working_hours(
        start, end, [interval("01:00", "03:00", GAP_DAY)], NEW_YORK
    )


# New York, 2030-11-03 (Sunday): the clock goes back from 02:00 to 01:00.
FOLD_DAY = 6
FIRST_0145 = datetime(2030, 11, 3, 5, 45, tzinfo=UTC)


def test_block_in_repeated_hours_is_judged_by_the_clock() -> None:
    # 30 elapsed minutes: the clock goes from 01:45 back to 01:15.
    end = FIRST_0145 + timedelta(minutes=30)

    assert FIRST_0145.astimezone(NEW_YORK).hour == 1
    assert end.astimezone(NEW_YORK).minute == 15
    assert fits_working_hours(
        FIRST_0145, end, [interval("01:00", "02:00", FOLD_DAY)], NEW_YORK
    )


def test_block_leaving_the_interval_in_repeated_hours_does_not_fit() -> None:
    end = FIRST_0145 + timedelta(minutes=30)

    assert not fits_working_hours(
        FIRST_0145, end, [interval("01:30", "02:00", FOLD_DAY)], NEW_YORK
    )


def test_block_that_leaves_and_returns_in_repeated_hours_does_not_fit() -> None:
    start = datetime(2030, 11, 3, 5, 15, tzinfo=UTC)
    # 60 elapsed minutes: the clock shows 01:15 at both ends, but passes 01:59.
    end = start + timedelta(minutes=60)

    assert start.astimezone(NEW_YORK).time() == end.astimezone(NEW_YORK).time()
    assert not fits_working_hours(
        start, end, [interval("01:00", "01:30", FOLD_DAY)], NEW_YORK
    )
    assert fits_working_hours(
        start, end, [interval("01:00", "02:00", FOLD_DAY)], NEW_YORK
    )


def test_block_ending_when_the_clock_goes_back_to_the_interval_start_fits() -> None:
    start = datetime(2030, 11, 3, 5, 30, tzinfo=UTC)  # The first 01:30.
    # 30 elapsed minutes: the block ends just as the clock goes back to 01:00.
    end = start + timedelta(minutes=30)

    assert end.astimezone(NEW_YORK).hour == 1
    assert end.astimezone(NEW_YORK).minute == 0
    assert fits_working_hours(
        start, end, [interval("01:00", "03:00", FOLD_DAY)], NEW_YORK
    )


def test_block_ending_exactly_at_closing_in_the_second_hour_fits() -> None:
    start = datetime(2030, 11, 3, 5, 30, tzinfo=UTC)  # The first 01:30.
    # 90 elapsed minutes: the clock ends at 02:00, the second time around 01:xx.
    end = start + timedelta(minutes=90)

    assert fits_working_hours(
        start, end, [interval("01:00", "02:00", FOLD_DAY)], NEW_YORK
    )
    assert not fits_working_hours(
        start,
        end + timedelta(minutes=1),
        [interval("01:00", "02:00", FOLD_DAY)],
        NEW_YORK,
    )


def test_block_crossing_into_repeated_hours_must_stay_inside_the_interval() -> None:
    start = datetime(2030, 11, 3, 4, 30, tzinfo=UTC)  # 00:30, before the change.
    # 120 elapsed minutes: the clock ends at 01:30, after passing 01:59.
    end = start + timedelta(minutes=120)

    assert fits_working_hours(
        start, end, [interval("00:00", "02:00", FOLD_DAY)], NEW_YORK
    )
    assert not fits_working_hours(
        start, end, [interval("00:00", "01:45", FOLD_DAY)], NEW_YORK
    )


def summary(professional_id, start: datetime, end: datetime) -> AppointmentSummary:
    return AppointmentSummary(
        id=uuid4(),
        professional_id=professional_id,
        service_id=uuid4(),
        starts_at=start,
        ends_at=end,
        blocked_until=end,
        status="confirmed",
        customer_name="Cliente",
    )


def test_outside_hours_uses_the_intervals_of_each_professional() -> None:
    first, second = uuid4(), uuid4()
    inside = summary(first, sao_paulo(10), sao_paulo(11))
    outside = summary(second, sao_paulo(10), sao_paulo(11))
    without_hours = summary(uuid4(), sao_paulo(10), sao_paulo(11))

    result = appointments_outside_hours(
        [inside, outside, without_hours],
        {first: [interval("09:00", "18:00")], second: [interval("14:00", "18:00")]},
        SAO_PAULO,
    )

    assert result == [outside, without_hours]


def test_outside_hours_depends_on_the_time_zone() -> None:
    professional = uuid4()
    appointment = summary(professional, sao_paulo(9, 30), sao_paulo(10))
    intervals = {professional: [interval("09:00", "18:00")]}

    assert appointments_outside_hours([appointment], intervals, SAO_PAULO) == []
    assert appointments_outside_hours(
        [appointment], intervals, ZoneInfo("America/Manaus")
    ) == [appointment]


@mark.parametrize(
    ("min_advance", "max_days", "expected"),
    [(0, 1, True), (1440, 1, True), (1441, 1, False), (60, 30, True)],
)
def test_advance_window(min_advance: int, max_days: int, expected: bool) -> None:
    assert is_advance_window_valid(min_advance, max_days) is expected
