from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.schedule import WeeklyInterval
from app.models import WorkingHours


async def list_for_professional(
    session: AsyncSession, business_id: UUID, professional_id: UUID
) -> list[WorkingHours]:
    rows = await session.scalars(
        select(WorkingHours)
        .where(
            WorkingHours.business_id == business_id,
            WorkingHours.professional_id == professional_id,
        )
        .order_by(WorkingHours.weekday, WorkingHours.start_time)
    )
    return list(rows)


async def list_for_business(
    session: AsyncSession, business_id: UUID
) -> list[WorkingHours]:
    rows = await session.scalars(
        select(WorkingHours).where(WorkingHours.business_id == business_id)
    )
    return list(rows)


async def replace(
    session: AsyncSession,
    business_id: UUID,
    professional_id: UUID,
    intervals: Iterable[WeeklyInterval],
) -> None:
    await session.execute(
        delete(WorkingHours).where(
            WorkingHours.business_id == business_id,
            WorkingHours.professional_id == professional_id,
        )
    )
    session.add_all(
        WorkingHours(
            business_id=business_id,
            professional_id=professional_id,
            weekday=interval.weekday,
            start_time=interval.start_time,
            end_time=interval.end_time,
        )
        for interval in intervals
    )
    await session.flush()
