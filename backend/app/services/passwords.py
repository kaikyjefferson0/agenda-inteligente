from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_password
from app.domain.auth import PASSWORD_RESET_TTL
from app.domain.errors import AppError, ErrorCode
from app.domain.rate_limits import ACCOUNT_TOKEN_BY_IP, PASSWORD_FORGOT_BY_IP
from app.email.templates import EmailTemplate
from app.models import AccountTokenPurpose
from app.repositories import account_tokens, businesses, refresh_tokens, users
from app.services.account_tokens import (
    enqueue_email,
    get_usable_account_token,
    issue_account_token,
    lock_usable_account_token,
)
from app.services.rate_limits import consume_email_quota, enforce_rate_limit


async def forgot_password(
    session: AsyncSession,
    settings: Settings,
    *,
    email: str,
    client_ip: str,
    now: datetime,
) -> None:
    """Returns normally for any e-mail, so the caller cannot tell them apart."""
    await enforce_rate_limit(session, settings, PASSWORD_FORGOT_BY_IP, client_ip, now)

    user = await users.lock_by_email_for_auth(session, email)
    if user is None or not user.is_active or user.password_hash is None:
        return
    business = await businesses.get_by_id(session, user.business_id)
    if business is None or business.is_demo:  # RN28
        return
    if not await consume_email_quota(session, settings, user.email, now):
        # Keeps the count: otherwise repeated requests would never reach the cap.
        await session.commit()
        return

    await account_tokens.invalidate_unused(
        session, user.id, AccountTokenPurpose.PASSWORD_RESET, now
    )
    raw_token, expires_at = issue_account_token(
        session,
        user.id,
        AccountTokenPurpose.PASSWORD_RESET,
        PASSWORD_RESET_TTL,
        now,
    )
    enqueue_email(
        session,
        user.email,
        EmailTemplate.PASSWORD_RESET,
        {
            "url": f"{settings.frontend_base_url}/recuperar-senha/{raw_token}",
            "business_name": business.name,
            # D37: local time, with the offset, like the appointments.
            "expires_at": expires_at.astimezone(
                ZoneInfo(business.timezone)
            ).isoformat(),
        },
    )
    await session.commit()


async def reset_password(
    session: AsyncSession,
    settings: Settings,
    *,
    raw_token: str,
    new_password: str,
    client_ip: str,
    now: datetime,
) -> None:
    await enforce_rate_limit(session, settings, ACCOUNT_TOKEN_BY_IP, client_ip, now)
    purpose = AccountTokenPurpose.PASSWORD_RESET
    found = await get_usable_account_token(session, raw_token, purpose, now)
    user_id = found.user_id
    # Releases the connection during the slow hash.
    await session.commit()
    password_hash = await hash_password(new_password)

    user = await users.lock_by_id_for_auth(session, user_id)
    token = await lock_usable_account_token(session, raw_token, purpose, now)
    if user is None or not user.is_active or user.password_hash is None:
        raise AppError(ErrorCode.INVALID_TOKEN)

    user.password_hash = password_hash
    token.used_at = now
    await account_tokens.invalidate_unused(session, user.id, purpose, now)
    await refresh_tokens.revoke_all_for_user(session, user.id, now)
    await session.commit()
