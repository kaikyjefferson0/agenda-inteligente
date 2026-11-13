from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.auth import is_invitation_pending
from app.domain.errors import AppError, ErrorCode
from app.models import AccountTokenPurpose, Professional, User, UserRole
from app.repositories import (
    account_tokens,
    appointments,
    catalog,
    professionals,
    refresh_tokens,
    users,
)


@dataclass(frozen=True)
class ProfessionalProfile:
    id: UUID
    user_id: UUID
    name: str
    email: str
    is_bookable: bool
    is_active: bool
    invitation_pending: bool
    invitation_expires_at: datetime | None
    service_ids: list[UUID]


async def _load_profiles(
    session: AsyncSession, business_id: UUID, professional_id: UUID | None = None
) -> list[ProfessionalProfile]:
    rows = await professionals.list_with_users(
        session, business_id, professional_id=professional_id
    )
    service_ids = await professionals.list_service_ids(session, business_id)
    pending = {
        user.id
        for _, user in rows
        if is_invitation_pending(
            is_professional=user.role is UserRole.PROFESSIONAL,
            has_password=user.password_hash is not None,
            is_active=user.is_active,
        )
    }
    # D95: only the date, never the token. The users come from this business.
    expiries = await account_tokens.latest_unused_expiry(
        session, list(pending), AccountTokenPurpose.INVITE
    )
    return [
        ProfessionalProfile(
            id=professional.id,
            user_id=user.id,
            name=user.name,
            email=user.email,
            is_bookable=professional.is_bookable,
            is_active=user.is_active,
            invitation_pending=user.id in pending,
            invitation_expires_at=expiries.get(user.id),
            service_ids=service_ids.get(professional.id, []),
        )
        for professional, user in rows
    ]


async def list_professionals(
    session: AsyncSession, viewer: User
) -> list[ProfessionalProfile]:
    business_id = viewer.business_id
    if viewer.role is UserRole.OWNER:
        return await _load_profiles(session, business_id)
    own = await professionals.get_by_user(session, business_id, viewer.id)
    return [] if own is None else await _load_profiles(session, business_id, own.id)


async def start_serving(
    session: AsyncSession, *, owner: User
) -> tuple[ProfessionalProfile, bool]:
    """Returns the Owner's record, and whether this call created it.

    An Owner who stopped serving keeps the record and comes back with this same
    call (RN23). The lock on the user serializes two simultaneous calls.
    """
    business_id = owner.business_id
    await users.lock_by_id_for_auth(session, owner.id)
    professional = await professionals.get_by_user(session, business_id, owner.id)
    created = professional is None
    if professional is None:
        professional = Professional(business_id=business_id, user_id=owner.id)
        session.add(professional)
    else:
        professional.is_bookable = True
    await session.flush()
    profiles = await _load_profiles(session, business_id, professional.id)
    await session.commit()
    return profiles[0], created


async def deactivate_professional(
    session: AsyncSession, *, business_id: UUID, professional_id: UUID, now: datetime
) -> None:
    found = await professionals.get(session, business_id, professional_id)
    if found is None:
        raise AppError(ErrorCode.NOT_FOUND)

    # User before professional: accepting an invite locks the user and then
    # changes the professional, so the opposite order could cause a deadlock.
    user = await users.lock_by_id_for_auth(session, found.user_id)
    professional = await professionals.lock(session, business_id, professional_id)
    if user is None or professional is None:
        raise AppError(ErrorCode.NOT_FOUND)

    upcoming = await appointments.list_future_confirmed(
        session, business_id, now, professional_id=professional_id
    )
    if upcoming:  # RN23
        raise AppError(ErrorCode.APPOINTMENT_CONFLICTS, conflicts=upcoming)

    professional.is_bookable = False
    # RN23: the Owner keeps the login and only leaves new bookings.
    if user.role is UserRole.PROFESSIONAL:
        user.is_active = False
        await refresh_tokens.revoke_all_for_user(session, user.id, now)
        for purpose in AccountTokenPurpose:
            await account_tokens.invalidate_unused(session, user.id, purpose, now)
    await session.commit()


async def set_professional_services(
    session: AsyncSession,
    *,
    business_id: UUID,
    professional_id: UUID,
    service_ids: Sequence[UUID],
) -> ProfessionalProfile:
    """An inactive service is accepted: RN07 applies when a booking is made."""
    # Two simultaneous replacements would otherwise collide on the primary key.
    professional = await professionals.lock(session, business_id, professional_id)
    if professional is None:
        raise AppError(ErrorCode.NOT_FOUND)
    existing = await catalog.count_existing(session, business_id, service_ids)
    if existing != len(service_ids):
        # The same answer for a missing service and one of another business.
        raise AppError(ErrorCode.NOT_FOUND)
    await professionals.replace_services(
        session, business_id, professional_id, service_ids
    )
    profiles = await _load_profiles(session, business_id, professional_id)
    await session.commit()
    return profiles[0]
