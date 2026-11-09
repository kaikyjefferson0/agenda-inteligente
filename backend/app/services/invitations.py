from dataclasses import dataclass
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_password
from app.domain.auth import INVITE_TTL
from app.domain.errors import AppError, ErrorCode
from app.domain.rate_limits import ACCOUNT_TOKEN_BY_IP, INVITATIONS_BY_BUSINESS
from app.email.templates import EmailTemplate
from app.models import AccountTokenPurpose, Business, Professional, User, UserRole
from app.repositories import account_tokens, professionals, users
from app.services.account_tokens import (
    enqueue_email,
    get_usable_account_token,
    issue_account_token,
    lock_usable_account_token,
)
from app.services.rate_limits import (
    consume_email_quota,
    enforce_rate_limit,
    seconds_until_email_quota_resets,
)


@dataclass(frozen=True)
class Invitation:
    professional_id: UUID
    email: str
    expires_at: datetime


async def _create_or_renew_invitee(
    session: AsyncSession, business_id: UUID, name: str, email: str
) -> tuple[User, Professional]:
    existing = await users.lock_by_email_for_auth(session, email)
    if existing is not None:
        # Only a pending invite of this same business can be renewed. Anything
        # else belongs to someone else and must stay untouched.
        if (
            existing.business_id != business_id
            or existing.role is not UserRole.PROFESSIONAL
            or existing.password_hash is not None
            or not existing.is_active
        ):
            raise AppError(ErrorCode.EMAIL_IN_USE)
        professional = await professionals.get_by_user(
            session, business_id, existing.id
        )
        if professional is None:
            raise AppError(ErrorCode.EMAIL_IN_USE)
        existing.name = name
        return existing, professional

    user = User(
        business_id=business_id,
        name=name,
        email=email,
        role=UserRole.PROFESSIONAL,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(ErrorCode.EMAIL_IN_USE) from exc
    # Not bookable until the invite is accepted, but the Owner can already
    # configure services and working hours.
    professional = Professional(
        business_id=business_id, user_id=user.id, is_bookable=False
    )
    session.add(professional)
    await session.flush()
    return user, professional


async def invite_professional(
    session: AsyncSession,
    settings: Settings,
    *,
    business: Business,
    name: str,
    email: str,
    now: datetime,
) -> Invitation:
    if business.is_demo:  # RN28
        raise AppError(ErrorCode.DEMO_RESTRICTED)
    await enforce_rate_limit(
        session, settings, INVITATIONS_BY_BUSINESS, str(business.id), now
    )

    user, professional = await _create_or_renew_invitee(
        session, business.id, name, email
    )
    if not await consume_email_quota(session, settings, user.email, now):
        # Nothing is kept: the invited person could not be told about it.
        await session.rollback()
        raise AppError(
            ErrorCode.RATE_LIMITED,
            retry_after=seconds_until_email_quota_resets(now),
        )

    await account_tokens.invalidate_unused(
        session, user.id, AccountTokenPurpose.INVITE, now
    )
    raw_token, expires_at = issue_account_token(
        session, user.id, AccountTokenPurpose.INVITE, INVITE_TTL, now
    )
    enqueue_email(
        session,
        user.email,
        EmailTemplate.ACCOUNT_INVITE,
        {
            "url": f"{settings.frontend_base_url}/convite/{raw_token}",
            "business_name": business.name,
            # D37: local time, with the offset, like the appointments.
            "expires_at": expires_at.astimezone(
                ZoneInfo(business.timezone)
            ).isoformat(),
        },
    )
    invitation = Invitation(professional.id, user.email, expires_at)
    await session.commit()
    return invitation


async def accept_invitation(
    session: AsyncSession,
    settings: Settings,
    *,
    raw_token: str,
    password: str,
    client_ip: str,
    now: datetime,
) -> None:
    await enforce_rate_limit(session, settings, ACCOUNT_TOKEN_BY_IP, client_ip, now)
    purpose = AccountTokenPurpose.INVITE
    found = await get_usable_account_token(session, raw_token, purpose, now)
    user_id = found.user_id
    # Releases the connection during the slow hash.
    await session.commit()
    password_hash = await hash_password(password)

    user = await users.lock_by_id_for_auth(session, user_id)
    token = await lock_usable_account_token(session, raw_token, purpose, now)
    if user is None or not user.is_active or user.password_hash is not None:
        raise AppError(ErrorCode.INVALID_TOKEN)
    professional = await professionals.get_by_user(session, user.business_id, user.id)
    if professional is None:
        raise AppError(ErrorCode.INVALID_TOKEN)

    user.password_hash = password_hash
    token.used_at = now
    professional.is_bookable = True
    await session.commit()
