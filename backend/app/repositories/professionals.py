from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Professional


async def get_by_user(
    session: AsyncSession, business_id: UUID, user_id: UUID
) -> Professional | None:
    return await session.scalar(
        select(Professional).where(
            Professional.business_id == business_id,
            Professional.user_id == user_id,
        )
    )
