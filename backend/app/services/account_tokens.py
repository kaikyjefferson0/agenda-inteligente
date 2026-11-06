from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import generate_opaque_token, hash_opaque_token
from app.domain.auth import is_account_token_usable
from app.domain.errors import AppError, ErrorCode
from app.email.templates import EmailTemplate
from app.models import AccountToken, AccountTokenPurpose, EmailOutbox
from app.repositories import account_tokens


def issue_account_token(
    session: AsyncSession,
    user_id: UUID,
    purpose: AccountTokenPurpose,
    ttl: timedelta,
    now: datetime,
) -> tuple[str, datetime]:
    """Stores only the hash and returns the raw token, used once for the link."""
    raw_token = generate_opaque_token()
    expires_at = now + ttl
    session.add(
        AccountToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=hash_opaque_token(raw_token),
            expires_at=expires_at,
        )
    )
    return raw_token, expires_at


def enqueue_email(
    session: AsyncSession,
    to_email: str,
    template: EmailTemplate,
    payload: dict[str, Any],
) -> None:
    session.add(EmailOutbox(to_email=to_email, template=template, payload=payload))


def _require_usable(token: AccountToken | None, now: datetime) -> AccountToken:
    if token is None or not is_account_token_usable(
        token.used_at, token.expires_at, now
    ):
        raise AppError(ErrorCode.INVALID_TOKEN)
    return token


async def get_usable_account_token(
    session: AsyncSession,
    raw_token: str,
    purpose: AccountTokenPurpose,
    now: datetime,
) -> AccountToken:
    token_hash = hash_opaque_token(raw_token)
    return _require_usable(
        await account_tokens.get_by_hash(session, token_hash, purpose), now
    )


async def lock_usable_account_token(
    session: AsyncSession,
    raw_token: str,
    purpose: AccountTokenPurpose,
    now: datetime,
) -> AccountToken:
    """Rechecks under lock: of two concurrent uses, only the first passes."""
    token_hash = hash_opaque_token(raw_token)
    return _require_usable(
        await account_tokens.lock_by_hash(session, token_hash, purpose), now
    )
