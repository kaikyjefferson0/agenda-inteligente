from collections import defaultdict
from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Professional, ProfessionalService, User


async def get_by_user(
    session: AsyncSession, business_id: UUID, user_id: UUID
) -> Professional | None:
    return await session.scalar(
        select(Professional).where(
            Professional.business_id == business_id,
            Professional.user_id == user_id,
        )
    )


async def get(
    session: AsyncSession, business_id: UUID, professional_id: UUID
) -> Professional | None:
    return await session.scalar(
        select(Professional).where(
            Professional.business_id == business_id,
            Professional.id == professional_id,
        )
    )


async def lock(
    session: AsyncSession, business_id: UUID, professional_id: UUID
) -> Professional | None:
    """Serializes the writes to one schedule (see the data model)."""
    return await session.scalar(
        select(Professional)
        .where(
            Professional.business_id == business_id,
            Professional.id == professional_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def lock_all(session: AsyncSession, business_id: UUID) -> None:
    """Locks in id order, like every other flow with many professionals."""
    await session.execute(
        select(Professional.id)
        .where(Professional.business_id == business_id)
        .order_by(Professional.id)
        .with_for_update()
    )


async def list_with_users(
    session: AsyncSession, business_id: UUID, *, professional_id: UUID | None = None
) -> list[tuple[Professional, User]]:
    query = (
        select(Professional, User)
        .join(User, Professional.user_id == User.id)
        .where(Professional.business_id == business_id)
        .order_by(Professional.created_at, Professional.id)
    )
    if professional_id is not None:
        query = query.where(Professional.id == professional_id)
    rows = await session.execute(query)
    return [(row[0], row[1]) for row in rows]


async def list_service_ids(
    session: AsyncSession, business_id: UUID
) -> dict[UUID, list[UUID]]:
    rows = await session.execute(
        select(ProfessionalService.professional_id, ProfessionalService.service_id)
        .where(ProfessionalService.business_id == business_id)
        .order_by(ProfessionalService.service_id)
    )
    service_ids: dict[UUID, list[UUID]] = defaultdict(list)
    for professional_id, service_id in rows:
        service_ids[professional_id].append(service_id)
    return service_ids


async def replace_services(
    session: AsyncSession,
    business_id: UUID,
    professional_id: UUID,
    service_ids: Sequence[UUID],
) -> None:
    await session.execute(
        delete(ProfessionalService).where(
            ProfessionalService.business_id == business_id,
            ProfessionalService.professional_id == professional_id,
        )
    )
    session.add_all(
        ProfessionalService(
            business_id=business_id,
            professional_id=professional_id,
            service_id=service_id,
        )
        for service_id in service_ids
    )
    await session.flush()
