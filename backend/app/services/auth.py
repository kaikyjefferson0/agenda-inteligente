from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import (
    create_access_token,
    generate_opaque_token,
    hash_opaque_token,
    hash_password,
    password_needs_rehash,
    verify_password,
)
from app.domain.auth import (
    RefreshTokenState,
    classify_refresh_token,
    refresh_token_expiry,
)
from app.domain.errors import AppError, ErrorCode
from app.domain.rate_limits import (
    LOGIN_BY_IP,
    LOGIN_BY_IP_AND_EMAIL,
    REGISTER_BY_IP,
)
from app.models import Business, RefreshToken, User, UserRole
from app.repositories import refresh_tokens, users
from app.services.rate_limits import enforce_rate_limit


@dataclass(frozen=True)
class IssuedSession:
    access_token: str
    refresh_token: str
    refresh_expires_at: datetime


def _issue_session(
    session: AsyncSession,
    settings: Settings,
    user_id: UUID,
    family_id: UUID,
    family_started_at: datetime,
    now: datetime,
) -> IssuedSession:
    raw_refresh_token = generate_opaque_token()
    expires_at = refresh_token_expiry(family_started_at, now)
    session.add(
        RefreshToken(
            user_id=user_id,
            family_id=family_id,
            token_hash=hash_opaque_token(raw_refresh_token),
            expires_at=expires_at,
            # Explicit because RN31 measures the family's age from this value,
            # and it must follow the same clock as expires_at.
            created_at=now,
        )
    )
    return IssuedSession(
        access_token=create_access_token(user_id, family_id, now, settings.jwt_secret),
        refresh_token=raw_refresh_token,
        refresh_expires_at=expires_at,
    )


async def register(
    session: AsyncSession,
    settings: Settings,
    *,
    business_name: str,
    slug: str,
    timezone: str,
    owner_name: str,
    email: str,
    password: str,
    client_ip: str,
    now: datetime,
) -> IssuedSession:
    await enforce_rate_limit(session, settings, REGISTER_BY_IP, client_ip, now)
    password_hash = await hash_password(password)

    business = Business(name=business_name, slug=slug, timezone=timezone)
    session.add(business)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(ErrorCode.SLUG_IN_USE) from exc

    owner = User(
        business_id=business.id,
        name=owner_name,
        email=email,
        password_hash=password_hash,
        role=UserRole.OWNER,
    )
    session.add(owner)
    try:
        await session.flush()
    except IntegrityError as exc:
        # Also undoes the business: both are created in a single transaction.
        await session.rollback()
        raise AppError(ErrorCode.EMAIL_IN_USE) from exc

    issued = _issue_session(session, settings, owner.id, uuid4(), now, now)
    await session.commit()
    return issued


async def login(
    session: AsyncSession,
    settings: Settings,
    *,
    email: str,
    password: str,
    client_ip: str,
    now: datetime,
) -> IssuedSession:
    subject = f"{client_ip}|{email.casefold()}"
    await enforce_rate_limit(session, settings, LOGIN_BY_IP_AND_EMAIL, subject, now)
    await enforce_rate_limit(session, settings, LOGIN_BY_IP, client_ip, now)

    user = await users.get_by_email_for_auth(session, email)
    stored_hash = user.password_hash if user is not None else None
    # Releases the connection during the slow hash.
    await session.commit()

    # Always verifies, so every failure costs the same and looks the same.
    password_matches = await verify_password(stored_hash, password)
    if user is None or not password_matches or not user.is_active:
        raise AppError(ErrorCode.INVALID_CREDENTIALS)

    # A password reset may have finished during the verification, and it must
    # not leave behind a session opened with the old password.
    locked = await users.lock_by_id_for_auth(session, user.id)
    if locked is None or not locked.is_active or locked.password_hash != stored_hash:
        raise AppError(ErrorCode.INVALID_CREDENTIALS)

    if stored_hash is not None and password_needs_rehash(stored_hash):
        locked.password_hash = await hash_password(password)

    issued = _issue_session(session, settings, locked.id, uuid4(), now, now)
    await session.commit()
    return issued


async def refresh_session(
    session: AsyncSession,
    settings: Settings,
    *,
    raw_token: str | None,
    now: datetime,
) -> IssuedSession:
    if raw_token is None:
        raise AppError(ErrorCode.INVALID_REFRESH_TOKEN)
    token_hash = hash_opaque_token(raw_token)
    found = await refresh_tokens.get_by_hash(session, token_hash)
    if found is None:
        raise AppError(ErrorCode.INVALID_REFRESH_TOKEN)

    user = await users.lock_by_id_for_auth(session, found.user_id)
    token = await refresh_tokens.lock_by_hash(session, token_hash)
    if user is None or token is None:
        raise AppError(ErrorCode.INVALID_REFRESH_TOKEN)

    state = classify_refresh_token(
        token.used_at, token.revoked_at, token.expires_at, now
    )
    if state is RefreshTokenState.REUSED or (
        state is RefreshTokenState.ACTIVE and not user.is_active
    ):
        await refresh_tokens.revoke_family(session, token.family_id, now)
        # Committed before raising: the rollback that follows an error would
        # otherwise undo the revocation.
        await session.commit()
        raise AppError(ErrorCode.INVALID_REFRESH_TOKEN)
    if state is not RefreshTokenState.ACTIVE:
        raise AppError(ErrorCode.INVALID_REFRESH_TOKEN)

    token.used_at = now
    family_started_at = await refresh_tokens.get_family_started_at(
        session, token.family_id
    )
    issued = _issue_session(
        session, settings, user.id, token.family_id, family_started_at, now
    )
    await session.commit()
    return issued


async def logout(
    session: AsyncSession, *, raw_token: str | None, now: datetime
) -> None:
    if raw_token is None:
        return
    token = await refresh_tokens.get_by_hash(session, hash_opaque_token(raw_token))
    if token is None:
        return
    await refresh_tokens.revoke_family(session, token.family_id, now)
    await session.commit()
