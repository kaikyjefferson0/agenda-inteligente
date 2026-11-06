from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, User

# Authentication is the only flow that starts without a business. E-mails are
# unique across the system, so the "for_auth" lookups below are the single
# exception to the mandatory business_id. Everything else must be scoped.


async def get_by_email_for_auth(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == email))


async def lock_by_email_for_auth(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(
        select(User)
        .where(User.email == email)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


async def lock_by_id_for_auth(session: AsyncSession, user_id: UUID) -> User | None:
    """Serializes the session and credential changes of one user.

    Every flow locks the user before its tokens, which rules out deadlocks.
    FOR NO KEY UPDATE does not block inserts that reference the user.
    """
    return await session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


async def get_with_business_for_auth(
    session: AsyncSession, user_id: UUID
) -> tuple[User, Business] | None:
    row = (
        await session.execute(
            select(User, Business)
            .join(Business, User.business_id == Business.id)
            .where(User.id == user_id)
        )
    ).first()
    return None if row is None else (row[0], row[1])
