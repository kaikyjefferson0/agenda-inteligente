import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
ONE_DAY = timedelta(days=1)


@dataclass(frozen=True)
class RateLimit:
    name: str
    max_requests: int
    window: timedelta


LOGIN_BY_IP_AND_EMAIL = RateLimit("login_ip_email", 10, timedelta(minutes=15))
LOGIN_BY_IP = RateLimit("login_ip", 50, timedelta(minutes=15))
PASSWORD_FORGOT_BY_IP = RateLimit("password_forgot_ip", 5, timedelta(hours=1))
REGISTER_BY_IP = RateLimit("register_ip", 5, timedelta(hours=1))
ACCOUNT_TOKEN_BY_IP = RateLimit("account_token_ip", 10, timedelta(hours=1))
INVITATIONS_BY_BUSINESS = RateLimit("invitations_business", 20, timedelta(hours=1))
PUBLIC_BUSINESS_BY_IP = RateLimit("public_business_ip", 120, timedelta(minutes=1))
PUBLIC_AVAILABILITY_BY_IP = RateLimit(
    "public_availability_ip", 120, timedelta(minutes=1)
)
PUBLIC_BOOKING_BY_IP = RateLimit("public_booking_ip", 10, timedelta(hours=1))


def window_start(now: datetime, window: timedelta) -> datetime:
    """Fixed windows aligned to the epoch, so all processes agree on them."""
    return EPOCH + window * ((now - EPOCH) // window)


def seconds_until_window_end(now: datetime, window: timedelta) -> int:
    remaining = window_start(now, window) + window - now
    return max(1, math.ceil(remaining.total_seconds()))
