from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business


async def get_by_id(session: AsyncSession, business_id: UUID) -> Business | None:
    return await session.get(Business, business_id)
