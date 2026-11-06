from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Service


async def list_all(session: AsyncSession, business_id: UUID) -> list[Service]:
    rows = await session.scalars(
        select(Service)
        .where(Service.business_id == business_id)
        .order_by(Service.name, Service.id)
    )
    return list(rows)


async def list_active(session: AsyncSession, business_id: UUID) -> list[Service]:
    rows = await session.scalars(
        select(Service)
        .where(Service.business_id == business_id, Service.is_active)
        .order_by(Service.name, Service.id)
    )
    return list(rows)


async def get(
    session: AsyncSession, business_id: UUID, service_id: UUID
) -> Service | None:
    return await session.scalar(
        select(Service).where(
            Service.business_id == business_id, Service.id == service_id
        )
    )


async def count_existing(
    session: AsyncSession, business_id: UUID, service_ids: Sequence[UUID]
) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(Service)
        .where(Service.business_id == business_id, Service.id.in_(service_ids))
    )
    return count or 0
