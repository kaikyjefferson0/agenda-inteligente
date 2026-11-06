from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TimeBlock


async def list_for_professional(
    session: AsyncSession, business_id: UUID, professional_id: UUID
) -> list[TimeBlock]:
    rows = await session.scalars(
        select(TimeBlock)
        .where(
            TimeBlock.business_id == business_id,
            TimeBlock.professional_id == professional_id,
        )
        .order_by(TimeBlock.starts_at)
    )
    return list(rows)


async def get(
    session: AsyncSession, business_id: UUID, time_block_id: UUID
) -> TimeBlock | None:
    return await session.scalar(
        select(TimeBlock).where(
            TimeBlock.business_id == business_id, TimeBlock.id == time_block_id
        )
    )


async def remove(session: AsyncSession, business_id: UUID, time_block_id: UUID) -> bool:
    deleted = await session.scalar(
        delete(TimeBlock)
        .where(TimeBlock.business_id == business_id, TimeBlock.id == time_block_id)
        .returning(TimeBlock.id)
    )
    return deleted is not None
