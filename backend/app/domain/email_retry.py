"""D38 and D39: when the outbox tries again, and when it gives up."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

MAX_ATTEMPTS = 5
# After the 1st, 2nd, 3rd and 4th failed attempts. The 5th has no next one.
RETRY_DELAYS = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=15),
    timedelta(minutes=60),
)
# How long a reserved message stays out of the queue while it is being sent.
RESERVATION = timedelta(minutes=5)
MAX_AGE = timedelta(hours=24)
MAX_ERROR_LENGTH = 200
EXPIRED_ERROR = "expired"
HTTP_TOO_MANY_REQUESTS = 429


class FailureKind(StrEnum):
    TEMPORARY = "temporary"
    PERMANENT = "permanent"


@dataclass(frozen=True)
class Retry:
    next_attempt_at: datetime


@dataclass(frozen=True)
class GiveUp:
    pass


def classify_http_status(status_code: int) -> FailureKind:
    """A refusal of the provider, never a success.

    429 and 5xx pass with time; any other 4xx will be refused again. Anything
    else, such as a redirect, is unexpected, so it is tried again.
    """
    if 400 <= status_code < 500 and status_code != HTTP_TOO_MANY_REQUESTS:
        return FailureKind.PERMANENT
    return FailureKind.TEMPORARY


def retry_delay(attempts: int) -> timedelta | None:
    """The wait after `attempts` failed attempts, or None past the last one."""
    if attempts < 1 or attempts >= MAX_ATTEMPTS:
        return None
    return RETRY_DELAYS[attempts - 1]


def after_failure(attempts: int, kind: FailureKind, now: datetime) -> Retry | GiveUp:
    """`attempts` counts the one that just failed, as the reservation adds it."""
    delay = retry_delay(attempts)
    if kind is FailureKind.PERMANENT or delay is None:
        return GiveUp()
    return Retry(now + delay)


def is_expired(created_at: datetime, now: datetime) -> bool:
    """More than 24 hours old: the exact limit is still sent."""
    return now - created_at > MAX_AGE


def error_summary(error_type: str, status_code: int | None = None) -> str:
    """D40: only the type and the HTTP code, never the recipient nor a body."""
    summary = error_type if status_code is None else f"{error_type} {status_code}"
    return summary[:MAX_ERROR_LENGTH]
