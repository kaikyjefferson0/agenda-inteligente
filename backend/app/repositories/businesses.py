from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business


async def get_by_id(session: AsyncSession, business_id: UUID) -> Business | None:
    return await session.get(Business, business_id)


async def get_by_slug(session: AsyncSession, slug: str) -> Business | None:
    """The public entry point. The column is citext, so case does not matter."""
    return await session.scalar(select(Business).where(Business.slug == slug))


async def lock_by_id(session: AsyncSession, business_id: UUID) -> Business | None:
    """FOR NO KEY UPDATE: inserts that reference the business must not wait.

    A plain FOR UPDATE would conflict with the foreign key check of any write
    that already holds a professional's lock, and that could cause a deadlock.
    """
    return await session.scalar(
        select(Business)
        .where(Business.id == business_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
