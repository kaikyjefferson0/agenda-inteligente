from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.availability import BusyPeriod
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


async def busy_periods(
    session: AsyncSession,
    business_id: UUID,
    professional_ids: Sequence[UUID],
    starts_at: datetime,
    ends_at: datetime,
) -> dict[UUID, list[BusyPeriod]]:
    """RN04: every status but cancelled occupies [starts_at, blocked_until)."""
    rows = await session.execute(
        select(
            Appointment.professional_id,
            Appointment.starts_at,
            Appointment.blocked_until,
        ).where(
            Appointment.business_id == business_id,
            Appointment.professional_id.in_(professional_ids),
            Appointment.status != AppointmentStatus.CANCELLED,
            Appointment.starts_at < ends_at,
            Appointment.blocked_until > starts_at,
        )
    )
    periods: dict[UUID, list[BusyPeriod]] = defaultdict(list)
    for professional_id, period_start, period_end in rows:
        periods[professional_id].append(BusyPeriod(period_start, period_end))
    return periods


async def count_by_professional(
    session: AsyncSession,
    business_id: UUID,
    professional_ids: Sequence[UUID],
    starts_at: datetime,
    ends_at: datetime,
    *,
    excluding: UUID | None = None,
) -> dict[UUID, int]:
    """RN10: appointments that are not cancelled and start in the period.

    A reschedule leaves its own appointment out of the count (D20).
    """
    query = select(Appointment.professional_id, func.count()).where(
        Appointment.business_id == business_id,
        Appointment.professional_id.in_(professional_ids),
        Appointment.status != AppointmentStatus.CANCELLED,
        Appointment.starts_at >= starts_at,
        Appointment.starts_at < ends_at,
    )
    if excluding is not None:
        query = query.where(Appointment.id != excluding)
    rows = await session.execute(query.group_by(Appointment.professional_id))
    return {professional_id: count for professional_id, count in rows}


async def get_by_idempotency_key(
    session: AsyncSession, business_id: UUID, idempotency_key: str
) -> Appointment | None:
    return await session.scalar(
        select(Appointment)
        .where(
            Appointment.business_id == business_id,
            Appointment.idempotency_key == idempotency_key,
        )
        .execution_options(populate_existing=True)
    )


async def lock(
    session: AsyncSession, business_id: UUID, appointment_id: UUID
) -> Appointment | None:
    return await session.scalar(
        select(Appointment)
        .where(
            Appointment.business_id == business_id,
            Appointment.id == appointment_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _by_access_token_hash(token_hash: str) -> Select[Appointment]:
    """The customer link is the entry point, like a slug: no business_id yet."""
    return (
        select(Appointment)
        .where(Appointment.access_token_hash == token_hash)
        .execution_options(populate_existing=True)
    )


async def get_by_access_token_hash(
    session: AsyncSession, token_hash: str
) -> Appointment | None:
    return await session.scalar(_by_access_token_hash(token_hash))


async def lock_by_access_token_hash(
    session: AsyncSession, token_hash: str
) -> Appointment | None:
    """None also when a repeat replaced the token while this one waited (D11)."""
    return await session.scalar(_by_access_token_hash(token_hash).with_for_update())
