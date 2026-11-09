from datetime import UTC, datetime, timedelta

from pytest import mark

from app.domain.email_retry import (
    MAX_AGE,
    MAX_ATTEMPTS,
    MAX_ERROR_LENGTH,
    RESERVATION,
    FailureKind,
    GiveUp,
    Retry,
    after_failure,
    classify_http_status,
    error_summary,
    is_expired,
    retry_delay,
)

NOW = datetime(2030, 3, 4, 12, 0, tzinfo=UTC)
ONE_MICROSECOND = timedelta(microseconds=1)


@mark.parametrize(
    ("attempts", "minutes"),
    [(1, 1), (2, 5), (3, 15), (4, 60)],
)
def test_d39_each_failed_attempt_waits_longer(attempts: int, minutes: int) -> None:
    assert retry_delay(attempts) == timedelta(minutes=minutes)
    assert after_failure(attempts, FailureKind.TEMPORARY, NOW) == Retry(
        NOW + timedelta(minutes=minutes)
    )


def test_d39_the_fifth_attempt_is_the_last() -> None:
    assert MAX_ATTEMPTS == 5
    assert retry_delay(MAX_ATTEMPTS) is None
    assert after_failure(MAX_ATTEMPTS, FailureKind.TEMPORARY, NOW) == GiveUp()
    assert after_failure(MAX_ATTEMPTS + 1, FailureKind.TEMPORARY, NOW) == GiveUp()


def test_d39_no_attempt_has_no_wait() -> None:
    assert retry_delay(0) is None


@mark.parametrize("attempts", [1, 2, 3, 4, 5])
def test_d39_a_permanent_failure_gives_up_at_once(attempts: int) -> None:
    assert after_failure(attempts, FailureKind.PERMANENT, NOW) == GiveUp()


@mark.parametrize(
    ("status_code", "kind"),
    [
        (400, FailureKind.PERMANENT),
        (401, FailureKind.PERMANENT),
        (403, FailureKind.PERMANENT),
        (422, FailureKind.PERMANENT),
        (428, FailureKind.PERMANENT),
        (429, FailureKind.TEMPORARY),
        (430, FailureKind.PERMANENT),
        (499, FailureKind.PERMANENT),
        (500, FailureKind.TEMPORARY),
        (502, FailureKind.TEMPORARY),
        (503, FailureKind.TEMPORARY),
        (599, FailureKind.TEMPORARY),
        (302, FailureKind.TEMPORARY),
    ],
)
def test_d39_http_codes_are_classified(status_code: int, kind: FailureKind) -> None:
    assert classify_http_status(status_code) is kind


def test_d39_a_message_expires_only_past_24_hours() -> None:
    assert MAX_AGE == timedelta(hours=24)
    assert not is_expired(NOW - MAX_AGE, NOW)
    assert is_expired(NOW - MAX_AGE - ONE_MICROSECOND, NOW)
    assert not is_expired(NOW, NOW)


def test_d38_the_reservation_lasts_5_minutes() -> None:
    assert RESERVATION == timedelta(minutes=5)


def test_d40_the_summary_has_only_the_type_and_the_code() -> None:
    assert error_summary("HTTPStatusError", 503) == "HTTPStatusError 503"
    assert error_summary("ConnectTimeout") == "ConnectTimeout"


def test_d40_the_summary_has_at_most_200_characters() -> None:
    assert MAX_ERROR_LENGTH == 200
    assert error_summary("E" * 300) == "E" * 200
    assert len(error_summary("E" * 198, 503)) == 200
