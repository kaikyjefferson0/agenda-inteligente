from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.availability import BusyPeriod
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


async def busy_periods(
    session: AsyncSession,
    business_id: UUID,
    professional_ids: Sequence[UUID],
    starts_at: datetime,
    ends_at: datetime,
) -> dict[UUID, list[BusyPeriod]]:
    rows = await session.execute(
        select(TimeBlock.professional_id, TimeBlock.starts_at, TimeBlock.ends_at).where(
            TimeBlock.business_id == business_id,
            TimeBlock.professional_id.in_(professional_ids),
            TimeBlock.starts_at < ends_at,
            TimeBlock.ends_at > starts_at,
        )
    )
    periods: dict[UUID, list[BusyPeriod]] = defaultdict(list)
    for professional_id, period_start, period_end in rows:
        periods[professional_id].append(BusyPeriod(period_start, period_end))
    return periods


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
