from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.schedule import AppointmentSummary
from app.models import Appointment, AppointmentStatus


async def _summaries(
    session: AsyncSession, query: Select[Appointment]
) -> list[AppointmentSummary]:
    rows = await session.scalars(query.order_by(Appointment.starts_at, Appointment.id))
    return [
        AppointmentSummary(
            id=row.id,
            professional_id=row.professional_id,
            service_id=row.service_id,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            blocked_until=row.blocked_until,
            status=row.status.value,
            customer_name=row.customer_name,
        )
        for row in rows
    ]


async def list_future_confirmed(
    session: AsyncSession,
    business_id: UUID,
    now: datetime,
    *,
    professional_id: UUID | None = None,
) -> list[AppointmentSummary]:
    """An appointment already in progress no longer counts as future."""
    query = select(Appointment).where(
        Appointment.business_id == business_id,
        Appointment.status == AppointmentStatus.CONFIRMED,
        Appointment.starts_at > now,
    )
    if professional_id is not None:
        query = query.where(Appointment.professional_id == professional_id)
    return await _summaries(session, query)


async def list_occupying(
    session: AsyncSession,
    business_id: UUID,
    professional_id: UUID,
    starts_at: datetime,
    ends_at: datetime,
) -> list[AppointmentSummary]:
    """RN04: every status but cancelled occupies [starts_at, blocked_until)."""
    return await _summaries(
        session,
        select(Appointment).where(
            Appointment.business_id == business_id,
            Appointment.professional_id == professional_id,
            Appointment.status != AppointmentStatus.CANCELLED,
            Appointment.starts_at < ends_at,
            Appointment.blocked_until > starts_at,
        ),
    )
