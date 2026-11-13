from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AccountToken, AccountTokenPurpose

# These tokens have no business_id (see the data model): they are reached by
# their hash or through a user that the caller already resolved.


async def get_by_hash(
    session: AsyncSession, token_hash: str, purpose: AccountTokenPurpose
) -> AccountToken | None:
    return await session.scalar(
        select(AccountToken).where(
            AccountToken.token_hash == token_hash,
            AccountToken.purpose == purpose,
        )
    )


async def lock_by_hash(
    session: AsyncSession, token_hash: str, purpose: AccountTokenPurpose
) -> AccountToken | None:
    return await session.scalar(
        select(AccountToken)
        .where(
            AccountToken.token_hash == token_hash,
            AccountToken.purpose == purpose,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def invalidate_unused(
    session: AsyncSession,
    user_id: UUID,
    purpose: AccountTokenPurpose,
    now: datetime,
) -> None:
    await session.execute(
        update(AccountToken)
        .where(
            AccountToken.user_id == user_id,
            AccountToken.purpose == purpose,
            AccountToken.used_at.is_(None),
        )
        .values(used_at=now)
    )


async def latest_unused_expiry(
    session: AsyncSession, user_ids: Sequence[UUID], purpose: AccountTokenPurpose
) -> dict[UUID, datetime]:
    """When the link still outstanding for each user expires, if there is one.

    A renewal marks the previous links as used, so only one is left unused; an
    expired one is still returned, with its date in the past.
    """
    if not user_ids:
        return {}
    rows = await session.execute(
        select(AccountToken.user_id, func.max(AccountToken.expires_at))
        .where(
            AccountToken.user_id.in_(user_ids),
            AccountToken.purpose == purpose,
            AccountToken.used_at.is_(None),
        )
        .group_by(AccountToken.user_id)
    )
    return {user_id: expires_at for user_id, expires_at in rows}


async def delete_for_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(delete(AccountToken).where(AccountToken.user_id == user_id))
