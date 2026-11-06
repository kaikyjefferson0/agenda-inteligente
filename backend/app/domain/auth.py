from datetime import datetime, timedelta
from enum import StrEnum

# RN30
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128

# RN24
INVITE_TTL = timedelta(days=7)
PASSWORD_RESET_TTL = timedelta(hours=1)

# RN31
REFRESH_IDLE_TTL = timedelta(days=7)
REFRESH_ABSOLUTE_TTL = timedelta(days=30)


class RefreshTokenState(StrEnum):
    ACTIVE = "active"
    REUSED = "reused"
    REVOKED = "revoked"
    EXPIRED = "expired"


def classify_refresh_token(
    used_at: datetime | None,
    revoked_at: datetime | None,
    expires_at: datetime,
    now: datetime,
) -> RefreshTokenState:
    # Reuse comes first: a used token is a signal of theft even after it expires.
    if used_at is not None:
        return RefreshTokenState.REUSED
    if revoked_at is not None:
        return RefreshTokenState.REVOKED
    if now >= expires_at:
        return RefreshTokenState.EXPIRED
    return RefreshTokenState.ACTIVE


def refresh_token_expiry(family_started_at: datetime, now: datetime) -> datetime:
    """RN31: slides with each use, up to the absolute limit since the login."""
    return min(now + REFRESH_IDLE_TTL, family_started_at + REFRESH_ABSOLUTE_TTL)


def is_account_token_usable(
    used_at: datetime | None, expires_at: datetime, now: datetime
) -> bool:
    return used_at is None and now < expires_at
