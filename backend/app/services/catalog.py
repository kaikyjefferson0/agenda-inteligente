from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import AppError, ErrorCode
from app.models import Business, Service
from app.repositories import catalog


async def list_services(session: AsyncSession, business_id: UUID) -> list[Service]:
    return await catalog.list_all(session, business_id)


async def create_service(
    session: AsyncSession,
    *,
    business: Business,
    name: str,
    duration_minutes: int,
    preparation_minutes: int,
    price_cents: int,
) -> Service:
    if business.is_demo:  # RN28
        raise AppError(ErrorCode.DEMO_RESTRICTED)
    service = Service(
        business_id=business.id,
        name=name,
        duration_minutes=duration_minutes,
        preparation_minutes=preparation_minutes,
        price_cents=price_cents,
    )
    session.add(service)
    await session.commit()
    return service


async def update_service(
    session: AsyncSession,
    *,
    business: Business,
    service_id: UUID,
    changes: Mapping[str, Any],
) -> Service:
    """Appointments keep their own copy of the values (RN11), so they don't change.

    There is no deletion: a service leaves new bookings with `is_active = false`.
    """
    service = await catalog.get(session, business.id, service_id)
    if service is None:
        raise AppError(ErrorCode.NOT_FOUND)
    if business.is_demo and changes.get("name", service.name) != service.name:  # RN28
        raise AppError(ErrorCode.DEMO_RESTRICTED)
    for field, value in changes.items():
        setattr(service, field, value)
    await session.commit()
    return service
