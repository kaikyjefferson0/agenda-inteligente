from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import AppError, ErrorCode
from app.domain.schedule import (
    AppointmentSummary,
    WeeklyInterval,
    appointments_outside_hours,
)
from app.models import Professional, TimeBlock, User, UserRole, WorkingHours
from app.repositories import appointments, professionals, time_blocks, working_hours


@dataclass(frozen=True)
class WorkingHoursUpdate:
    intervals: list[WorkingHours]
    appointments_outside_hours: list[AppointmentSummary]


def ensure_can_manage(viewer: User, professional: Professional) -> None:
    """Runs after the lookup by business, so another business only ever sees 404."""
    if viewer.role is UserRole.OWNER or professional.user_id == viewer.id:
        return
    raise AppError(ErrorCode.FORBIDDEN)


async def get_manageable(
    session: AsyncSession, viewer: User, professional_id: UUID
) -> Professional:
    professional = await professionals.get(session, viewer.business_id, professional_id)
    if professional is None:
        raise AppError(ErrorCode.NOT_FOUND)
    ensure_can_manage(viewer, professional)
    return professional


async def _lock_professional(
    session: AsyncSession, business_id: UUID, professional_id: UUID
) -> None:
    locked = await professionals.lock(session, business_id, professional_id)
    if locked is None:
        raise AppError(ErrorCode.NOT_FOUND)


async def find_appointments_outside_hours(
    session: AsyncSession, business_id: UUID, timezone: str, now: datetime
) -> list[AppointmentSummary]:
    """Every professional of the business, for a change that affects them all."""
    rows = await working_hours.list_for_business(session, business_id)
    intervals: dict[UUID, list[WeeklyInterval]] = defaultdict(list)
    for row in rows:
        intervals[row.professional_id].append(row)
    upcoming = await appointments.list_future_confirmed(session, business_id, now)
    return appointments_outside_hours(upcoming, intervals, ZoneInfo(timezone))


async def get_working_hours(
    session: AsyncSession, *, viewer: User, professional_id: UUID
) -> list[WorkingHours]:
    await get_manageable(session, viewer, professional_id)
    return await working_hours.list_for_professional(
        session, viewer.business_id, professional_id
    )


async def replace_working_hours(
    session: AsyncSession,
    *,
    viewer: User,
    timezone: str,
    professional_id: UUID,
    intervals: Iterable[WeeklyInterval],
    now: datetime,
) -> WorkingHoursUpdate:
    """RN22: always accepted. Appointments stay, and those left out are listed."""
    business_id = viewer.business_id
    await get_manageable(session, viewer, professional_id)
    await _lock_professional(session, business_id, professional_id)

    await working_hours.replace(session, business_id, professional_id, intervals)
    stored = await working_hours.list_for_professional(
        session, business_id, professional_id
    )
    upcoming = await appointments.list_future_confirmed(
        session, business_id, now, professional_id=professional_id
    )
    outside = appointments_outside_hours(
        upcoming, {professional_id: stored}, ZoneInfo(timezone)
    )
    await session.commit()
    return WorkingHoursUpdate(stored, outside)


async def list_time_blocks(
    session: AsyncSession, *, viewer: User, professional_id: UUID
) -> list[TimeBlock]:
    await get_manageable(session, viewer, professional_id)
    return await time_blocks.list_for_professional(
        session, viewer.business_id, professional_id
    )


async def create_time_block(
    session: AsyncSession,
    *,
    viewer: User,
    professional_id: UUID,
    starts_at: datetime,
    ends_at: datetime,
    reason: str,
) -> TimeBlock:
    business_id = viewer.business_id
    await get_manageable(session, viewer, professional_id)
    await _lock_professional(session, business_id, professional_id)

    conflicts = await appointments.list_occupying(
        session, business_id, professional_id, starts_at, ends_at
    )
    if conflicts:  # RN21
        raise AppError(ErrorCode.APPOINTMENT_CONFLICTS, conflicts=conflicts)

    block = TimeBlock(
        business_id=business_id,
        professional_id=professional_id,
        starts_at=starts_at,
        ends_at=ends_at,
        reason=reason,
    )
    session.add(block)
    try:
        await session.flush()
    except IntegrityError as exc:
        # time_blocks_no_overlap is the only constraint the input can still break.
        await session.rollback()
        raise AppError(ErrorCode.TIME_BLOCK_OVERLAP) from exc
    await session.commit()
    return block


async def delete_time_block(
    session: AsyncSession, *, viewer: User, time_block_id: UUID
) -> None:
    business_id = viewer.business_id
    block = await time_blocks.get(session, business_id, time_block_id)
    if block is None:
        raise AppError(ErrorCode.NOT_FOUND)
    professional_id = block.professional_id
    await get_manageable(session, viewer, professional_id)
    await _lock_professional(session, business_id, professional_id)

    # A simultaneous call may have removed it while this one waited for the lock.
    if not await time_blocks.remove(session, business_id, time_block_id):
        raise AppError(ErrorCode.NOT_FOUND)
    await session.commit()
