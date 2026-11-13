from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken

# These tokens have no business_id (see the data model): they are reached by
# their hash or through a user that was already authenticated.


async def get_by_hash(session: AsyncSession, token_hash: str) -> RefreshToken | None:
    return await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )


async def lock_by_hash(session: AsyncSession, token_hash: str) -> RefreshToken | None:
    return await session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def get_family_started_at(session: AsyncSession, family_id: UUID) -> datetime:
    """The first token of a family is created at login (RN31).

    Any cleanup job must therefore delete whole families, never single rows.
    """
    started_at = await session.scalar(
        select(func.min(RefreshToken.created_at)).where(
            RefreshToken.family_id == family_id
        )
    )
    if started_at is None:
        raise LookupError("refresh token family not found")
    return started_at


async def revoke_family(session: AsyncSession, family_id: UUID, now: datetime) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def delete_for_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))


async def revoke_all_for_user(
    session: AsyncSession, user_id: UUID, now: datetime
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def is_family_active(
    session: AsyncSession, family_id: UUID, user_id: UUID
) -> bool:
    active = await session.scalar(
        select(
            exists().where(
                RefreshToken.family_id == family_id,
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
        )
    )
    return bool(active)
