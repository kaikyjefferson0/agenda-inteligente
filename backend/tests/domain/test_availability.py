from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pytest import mark

from app.domain.availability import (
    BookingRules,
    BusyPeriod,
    available_slots,
    is_day_within_advance,
    is_on_grid,
    is_within_advance,
    local_day_bounds,
)

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
NEW_YORK = ZoneInfo("America/New_York")
# 2030-01-07 is a Monday, and São Paulo is at UTC-3.
MONDAY = date(2030, 1, 7)
SUNDAY = 6
NOW = datetime(2030, 1, 1, 12, 0, tzinfo=UTC)


@dataclass(frozen=True)
class Interval:
    weekday: int
    start_time: time
    end_time: time


def interval(start: str, end: str, weekday: int = MONDAY.weekday()) -> Interval:
    return Interval(weekday, time.fromisoformat(start), time.fromisoformat(end))


def rules(
    *,
    timezone: ZoneInfo = SAO_PAULO,
    step: int = 15,
    min_advance: int = 60,
    max_days: int = 30,
) -> BookingRules:
    return BookingRules(timezone, step, min_advance, max_days)


def at(hour: int, minute: int = 0, day: date = MONDAY) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=SAO_PAULO)


def busy(start: datetime, end: datetime) -> BusyPeriod:
    return BusyPeriod(start.astimezone(UTC), end.astimezone(UTC))


def slots(
    intervals: Iterable[Interval],
    *,
    day: date = MONDAY,
    occupied: Iterable[BusyPeriod] = (),
    duration: int = 30,
    preparation: int = 0,
    now: datetime = NOW,
    booking_rules: BookingRules | None = None,
) -> list[datetime]:
    return available_slots(
        day,
        rules=booking_rules or rules(),
        intervals=intervals,
        busy=occupied,
        duration_minutes=duration,
        preparation_minutes=preparation,
        now=now,
    )


def local_times(found: Iterable[datetime], timezone: ZoneInfo = SAO_PAULO) -> list[str]:
    return [slot.astimezone(timezone).strftime("%H:%M") for slot in found]


@mark.parametrize(
    ("step", "expected"),
    [
        (5, ["09:00", "09:05", "09:10", "09:15"]),
        (10, ["09:00", "09:10"]),
        (15, ["09:00", "09:15"]),
        (20, ["09:00"]),
        (30, ["09:00"]),
        (60, ["09:00"]),
    ],
)
def test_rn01_each_step_defines_the_start_times(step: int, expected: list[str]) -> None:
    found = slots(
        [interval("09:00", "09:30")],
        duration=15,
        booking_rules=rules(step=step),
    )

    assert local_times(found) == expected


def test_rn02_times_are_multiples_of_the_step_counted_from_midnight() -> None:
    found = slots([interval("09:10", "10:00")], duration=15)

    assert local_times(found) == ["09:15", "09:30", "09:45"]


def test_slots_are_returned_in_utc_and_in_order() -> None:
    found = slots([interval("13:00", "14:00"), interval("09:00", "10:00")])

    assert found[0] == datetime(2030, 1, 7, 12, 0, tzinfo=UTC)
    assert found == sorted(found)
    assert all(slot.utcoffset() == timedelta(0) for slot in found)


def test_ct01_service_with_preparation_that_does_not_fit_is_not_offered() -> None:
    # RN03: ending at 18:00, 30 minutes plus 10 of preparation start at 17:20 at most.
    found = slots(
        [interval("17:00", "18:00")],
        duration=30,
        preparation=10,
        booking_rules=rules(step=5),
    )

    assert found[-1] == at(17, 20).astimezone(UTC)
    assert at(17, 25).astimezone(UTC) not in found


def test_ct01_without_preparation_the_block_may_end_exactly_at_closing() -> None:
    found = slots([interval("17:00", "18:00")], duration=30)

    assert local_times(found) == ["17:00", "17:15", "17:30"]


def test_rn03_block_must_fit_in_a_single_interval() -> None:
    # Touching intervals are kept apart: no service crosses 12:00.
    found = slots(
        [interval("11:00", "12:00"), interval("12:00", "13:00")],
        duration=45,
    )

    assert local_times(found) == ["11:00", "11:15", "12:00", "12:15"]


def test_lunch_break_is_not_offered() -> None:
    found = slots(
        [interval("11:00", "12:00"), interval("13:00", "14:00")],
        duration=60,
    )

    assert local_times(found) == ["11:00", "13:00"]


def test_day_without_working_hours_has_no_slots() -> None:
    other_weekday = interval("09:00", "18:00", weekday=2)

    assert slots([other_weekday]) == []
    assert slots([]) == []


def test_ct02_overlapping_an_appointment_is_not_offered() -> None:
    found = slots(
        [interval("09:00", "11:00")],
        occupied=[busy(at(10), at(10, 30))],
    )

    assert local_times(found) == ["09:00", "09:15", "09:30", "10:30"]


def test_ct02_the_preparation_of_an_appointment_counts_as_occupied() -> None:
    # The caller gives blocked_until as the end: 10:30 plus 10 of preparation.
    found = slots(
        [interval("09:30", "11:30")],
        occupied=[busy(at(10), at(10, 40))],
    )

    assert "10:30" not in local_times(found)
    assert "10:45" in local_times(found)


def test_ct02_the_preparation_of_the_new_block_also_counts() -> None:
    found = slots(
        [interval("09:00", "11:00")],
        occupied=[busy(at(10), at(10, 30))],
        duration=30,
        preparation=15,
    )

    # 09:15 ends at 10:00 with the preparation, and 09:30 only at 10:15. From 10:30
    # on, the block no longer fits before closing.
    assert local_times(found) == ["09:00", "09:15"]


def test_ct02_a_block_covering_the_whole_day_leaves_nothing() -> None:
    found = slots(
        [interval("09:00", "18:00")],
        occupied=[busy(at(0), at(23, 59))],
    )

    assert found == []


def test_rn04_a_block_may_end_exactly_when_another_starts() -> None:
    found = slots(
        [interval("09:30", "10:30")],
        occupied=[busy(at(10), at(10, 30))],
        duration=30,
    )

    assert local_times(found) == ["09:30"]


def test_rn04_a_block_may_start_exactly_when_another_ends() -> None:
    found = slots(
        [interval("10:00", "11:00")],
        occupied=[busy(at(10), at(10, 30))],
        duration=30,
    )

    assert local_times(found) == ["10:30"]


def test_ct04_before_the_minimum_advance_is_not_offered() -> None:
    now = at(9).astimezone(UTC)

    found = slots(
        [interval("09:00", "12:00")],
        duration=60,
        now=now,
        booking_rules=rules(step=30, min_advance=60),
    )

    # The exact limit, at 10:00, is allowed.
    assert local_times(found) == ["10:00", "10:30", "11:00"]


def test_ct04_after_the_maximum_advance_is_not_offered() -> None:
    now = at(10, day=date(2030, 1, 6)).astimezone(UTC)

    found = slots(
        [interval("09:00", "12:00")],
        duration=30,
        now=now,
        booking_rules=rules(step=30, min_advance=0, max_days=1),
    )

    # The exact limit, at 10:00, is allowed.
    assert local_times(found) == ["09:00", "09:30", "10:00"]


@mark.parametrize(
    "day",
    [date(2029, 12, 31), date(2030, 3, 1), date.min, date.max],
    ids=["past", "too_far", "first_date", "last_date"],
)
def test_ct04_day_outside_the_advance_window_has_no_slots(day: date) -> None:
    every_weekday = [
        interval("09:00", "18:00", weekday=weekday) for weekday in range(7)
    ]

    assert slots(every_weekday, day=day) == []


def test_advance_window_limits_are_inclusive() -> None:
    booking_rules = rules(min_advance=60, max_days=1)
    earliest = NOW + timedelta(minutes=60)
    latest = NOW + timedelta(days=1)

    assert is_within_advance(earliest, booking_rules, NOW)
    assert is_within_advance(latest, booking_rules, NOW)
    assert not is_within_advance(earliest - timedelta(seconds=1), booking_rules, NOW)
    assert not is_within_advance(latest + timedelta(seconds=1), booking_rules, NOW)


def test_day_of_the_window_is_the_local_one() -> None:
    # 2030-01-02 01:00 in UTC is still 2030-01-01 in São Paulo.
    now = datetime(2030, 1, 2, 1, 0, tzinfo=UTC)
    booking_rules = rules(min_advance=0, max_days=1)

    assert is_day_within_advance(date(2030, 1, 1), booking_rules, now)
    assert not is_day_within_advance(date(2029, 12, 31), booking_rules, now)


# New York, 2030-03-10 (Sunday): the clock jumps from 02:00 to 03:00.
GAP_DAY = date(2030, 3, 10)
BEFORE_GAP = datetime(2030, 3, 1, tzinfo=UTC)
# New York, 2030-11-03 (Sunday): the clock goes back from 02:00 to 01:00.
FOLD_DAY = date(2030, 11, 3)
BEFORE_FOLD = datetime(2030, 10, 25, tzinfo=UTC)


def new_york_slots(
    intervals: Iterable[Interval],
    *,
    day: date,
    now: datetime,
    duration: int = 30,
    step: int = 30,
) -> list[datetime]:
    return slots(
        intervals,
        day=day,
        now=now,
        duration=duration,
        booking_rules=rules(timezone=NEW_YORK, step=step),
    )


def utc(month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2030, month, day, hour, minute, tzinfo=UTC)


def test_ct05_skipped_local_times_are_discarded() -> None:
    found = new_york_slots(
        [interval("01:00", "04:00", SUNDAY)], day=GAP_DAY, now=BEFORE_GAP
    )

    assert local_times(found, NEW_YORK) == ["01:00", "01:30", "03:00", "03:30"]
    # UTC-5 before the jump and UTC-4 after it.
    assert found == [
        utc(3, 10, 6),
        utc(3, 10, 6, 30),
        utc(3, 10, 7),
        utc(3, 10, 7, 30),
    ]


def test_ct05_working_hours_inside_the_skipped_hour_offer_nothing() -> None:
    found = new_york_slots(
        [interval("02:00", "03:00", SUNDAY)], day=GAP_DAY, now=BEFORE_GAP
    )

    assert found == []


def test_ct05_block_crossing_the_jump_takes_the_elapsed_time() -> None:
    found = new_york_slots(
        [interval("01:30", "03:30", SUNDAY)],
        day=GAP_DAY,
        now=BEFORE_GAP,
        duration=60,
    )

    # 01:30 plus 60 elapsed minutes is 03:30 on the clock.
    assert local_times(found, NEW_YORK) == ["01:30"]


def test_ct05_repeated_local_times_use_the_first_occurrence() -> None:
    found = new_york_slots(
        [interval("00:30", "03:00", SUNDAY)],
        day=FOLD_DAY,
        now=BEFORE_FOLD,
        duration=15,
    )

    assert local_times(found, NEW_YORK) == [
        "00:30",
        "01:00",
        "01:30",
        "02:00",
        "02:30",
    ]
    # UTC-4 until the first 01:59 and UTC-5 afterwards. 06:00 and 06:30 in UTC are
    # the second 01:00 and 01:30, which are not offered.
    assert found == [
        utc(11, 3, 4, 30),
        utc(11, 3, 5),
        utc(11, 3, 5, 30),
        utc(11, 3, 7),
        utc(11, 3, 7, 30),
    ]


def test_ct05_block_ending_when_the_clock_goes_back_is_offered() -> None:
    found = new_york_slots(
        [interval("01:00", "02:00", SUNDAY)], day=FOLD_DAY, now=BEFORE_FOLD
    )

    # The first 01:30 ends just as the clock shows 01:00 again.
    assert found == [utc(11, 3, 5), utc(11, 3, 5, 30)]


def test_ct05_block_that_leaves_the_interval_in_repeated_hours_is_not_offered() -> None:
    # 01:15 plus 60 elapsed minutes shows 01:15 again, but passes 01:30 on the way.
    found = new_york_slots(
        [interval("01:00", "01:30", SUNDAY)],
        day=FOLD_DAY,
        now=BEFORE_FOLD,
        duration=60,
        step=15,
    )

    assert found == []


def test_ct05_busy_period_in_the_second_occurrence_does_not_block_the_first() -> None:
    second_occurrence = BusyPeriod(utc(11, 3, 6), utc(11, 3, 6, 30))

    found = slots(
        [interval("01:00", "02:00", SUNDAY)],
        day=FOLD_DAY,
        now=BEFORE_FOLD,
        occupied=[second_occurrence],
        duration=30,
        booking_rules=rules(timezone=NEW_YORK, step=30),
    )

    assert found[0] == utc(11, 3, 5)


def test_ct05_ordinary_days_keep_the_offset_of_the_season() -> None:
    summer = new_york_slots(
        [interval("09:00", "10:00", 0)],
        day=date(2030, 7, 1),
        now=datetime(2030, 6, 20, tzinfo=UTC),
    )
    winter = new_york_slots(
        [interval("09:00", "10:00", 0)],
        day=date(2030, 1, 7),
        now=NOW,
    )

    assert summer[0] == utc(7, 1, 13)
    assert winter[0] == utc(1, 7, 14)


@mark.parametrize(
    ("instant", "step", "expected"),
    [
        (at(9, 15), 15, True),
        (at(9, 15), 10, False),
        (at(9, 7), 15, False),
        (at(9, 15) + timedelta(seconds=1), 15, False),
        (at(9, 15) + timedelta(microseconds=1), 15, False),
    ],
)
def test_is_on_grid(instant: datetime, step: int, expected: bool) -> None:
    assert is_on_grid(instant, rules(step=step)) is expected


def test_second_occurrence_of_a_repeated_time_is_not_on_the_grid() -> None:
    booking_rules = rules(timezone=NEW_YORK, step=30)

    assert is_on_grid(utc(11, 3, 5, 30), booking_rules)
    assert not is_on_grid(utc(11, 3, 6, 30), booking_rules)


def test_local_day_bounds_follow_the_length_of_the_day() -> None:
    assert local_day_bounds(MONDAY, SAO_PAULO) == (utc(1, 7, 3), utc(1, 8, 3))
    start, end = local_day_bounds(GAP_DAY, NEW_YORK)
    assert end - start == timedelta(hours=23)
    start, end = local_day_bounds(FOLD_DAY, NEW_YORK)
    assert end - start == timedelta(hours=25)
