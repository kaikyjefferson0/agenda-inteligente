from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
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
