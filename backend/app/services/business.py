from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.business import is_advance_window_valid
from app.domain.errors import AppError, ErrorCode
from app.domain.schedule import AppointmentSummary
from app.models import Business
from app.repositories import businesses, professionals
from app.services.schedule import find_appointments_outside_hours

DEMO_LOCKED_FIELDS = ("name", "slug")  # RN28


@dataclass(frozen=True)
class BusinessUpdate:
    business: Business
    appointments_outside_hours: list[AppointmentSummary]


async def update_business(
    session: AsyncSession,
    *,
    business_id: UUID,
    changes: Mapping[str, Any],
    now: datetime,
) -> BusinessUpdate:
    business = await businesses.lock_by_id(session, business_id)
    if business is None:
        raise AppError(ErrorCode.NOT_FOUND)

    if business.is_demo and any(
        field in changes and changes[field] != getattr(business, field)
        for field in DEMO_LOCKED_FIELDS
    ):
        raise AppError(ErrorCode.DEMO_RESTRICTED)

    # In a partial update, the other side of the window is the stored value.
    min_advance = changes.get("min_advance_minutes", business.min_advance_minutes)
    max_advance = changes.get("max_advance_days", business.max_advance_days)
    if not is_advance_window_valid(min_advance, max_advance):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            invalid_field=(
                "min_advance_minutes",
                "min_advance_minutes must not exceed max_advance_days",
            ),
        )

    new_timezone = changes.get("timezone", business.timezone)
    timezone_changed = new_timezone != business.timezone
    if timezone_changed:
        # The report must not miss a change to a schedule made at the same time.
        await professionals.lock_all(session, business_id)

    for field, value in changes.items():
        setattr(business, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise AppError(ErrorCode.SLUG_IN_USE) from exc

    outside = (
        await find_appointments_outside_hours(session, business_id, new_timezone, now)
        if timezone_changed
        else []
    )
    await session.commit()
    return BusinessUpdate(business, outside)
