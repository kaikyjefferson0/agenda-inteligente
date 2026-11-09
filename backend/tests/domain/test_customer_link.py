from datetime import UTC, datetime, timedelta

from pytest import mark

from app.domain.customer_link import (
    LINK_TTL,
    can_cancel,
    can_reschedule,
    change_deadline_at,
    change_refusal,
    is_link_expired,
    is_token_well_formed,
    is_within_change_deadline,
)
from app.domain.errors import ErrorCode

STARTS_AT = datetime(2030, 3, 4, 13, 0, tzinfo=UTC)
TWO_HOURS = 120
DEADLINE = STARTS_AT - timedelta(minutes=TWO_HOURS)
ONE_SECOND = timedelta(seconds=1)


def refusal(now: datetime, *, is_confirmed: bool = True) -> ErrorCode | None:
    return change_refusal(
        is_confirmed=is_confirmed,
        starts_at=STARTS_AT,
        change_deadline_minutes=TWO_HOURS,
        now=now,
    )


def test_deadline_is_the_start_minus_the_minutes_of_the_business() -> None:
    assert change_deadline_at(STARTS_AT, TWO_HOURS) == DEADLINE
    assert change_deadline_at(STARTS_AT, 0) == STARTS_AT


@mark.parametrize(
    ("now", "allowed"),
    [
        (DEADLINE - timedelta(days=1), True),
        (DEADLINE - ONE_SECOND, True),
        (DEADLINE, True),
        (DEADLINE + ONE_SECOND, False),
        (STARTS_AT, False),
    ],
    ids=["well_before", "just_before", "exact_limit", "just_after", "at_the_start"],
)
def test_ct12_the_exact_limit_of_the_deadline_is_allowed(
    now: datetime, allowed: bool
) -> None:
    assert is_within_change_deadline(STARTS_AT, TWO_HOURS, now) is allowed
    assert (refusal(now) is None) is allowed


def test_ct12_after_the_deadline_the_refusal_is_change_deadline_passed() -> None:
    assert refusal(DEADLINE + ONE_SECOND) is ErrorCode.CHANGE_DEADLINE_PASSED


def test_a_zero_deadline_allows_changes_until_the_start() -> None:
    assert is_within_change_deadline(STARTS_AT, 0, STARTS_AT)
    assert not is_within_change_deadline(STARTS_AT, 0, STARTS_AT + ONE_SECOND)


def test_d19_the_status_is_checked_before_the_deadline() -> None:
    """A final status answers the same before and after the deadline."""
    for now in (DEADLINE - ONE_SECOND, DEADLINE + ONE_SECOND):
        assert refusal(now, is_confirmed=False) is ErrorCode.INVALID_STATUS_TRANSITION


@mark.parametrize(
    ("is_confirmed", "now", "service_is_active", "cancel", "reschedule"),
    [
        (True, DEADLINE, True, True, True),
        (True, DEADLINE, False, True, False),
        (True, DEADLINE + ONE_SECOND, True, False, False),
        (False, DEADLINE, True, False, False),
    ],
    ids=["allowed", "service_inactive", "after_deadline", "final_status"],
)
def test_d21_actions_allowed_by_the_link(
    is_confirmed: bool,
    now: datetime,
    service_is_active: bool,
    cancel: bool,
    reschedule: bool,
) -> None:
    common = {
        "is_confirmed": is_confirmed,
        "starts_at": STARTS_AT,
        "change_deadline_minutes": TWO_HOURS,
        "now": now,
    }

    assert can_cancel(**common) is cancel
    assert can_reschedule(**common, service_is_active=service_is_active) is reschedule


@mark.parametrize(
    ("now", "expired"),
    [
        (STARTS_AT - timedelta(days=10), False),
        (STARTS_AT + LINK_TTL - ONE_SECOND, False),
        (STARTS_AT + LINK_TTL, False),
        (STARTS_AT + LINK_TTL + ONE_SECOND, True),
    ],
    ids=["before_the_start", "just_before", "exact_limit", "just_after"],
)
def test_rn16_the_link_works_up_to_30_days_after_the_start(
    now: datetime, expired: bool
) -> None:
    assert LINK_TTL == timedelta(days=30)
    assert is_link_expired(STARTS_AT, now) is expired


@mark.parametrize(
    ("token", "well_formed"),
    [
        ("Ab0_-" * 8 + "xyz", True),
        ("a", True),
        ("", False),
        ("a" * 129, False),
        ("token.com.ponto", False),
        ("token com espaço", False),
        ("token%2Fbarra", False),
        ("nulo\x00", False),
    ],
    ids=["issued", "short", "empty", "too_long", "dot", "space", "percent", "null"],
)
def test_only_tokens_in_the_issued_alphabet_are_well_formed(
    token: str, well_formed: bool
) -> None:
    assert is_token_well_formed(token) is well_formed
