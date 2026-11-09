"""UC15 to UC18: the team's agenda, without the customer's limits (RN19, RN20)."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import generate_opaque_token, hash_opaque_token
from app.domain.availability import overlaps_any
from app.domain.errors import AppError, ErrorCode
from app.domain.staff_appointments import (
    agenda_period_error,
    block_end,
    fits_staff_hours,
    outcome_refusal,
    staff_change_refusal,
)
from app.email.templates import EmailTemplate
from app.models import (
    Appointment,
    AppointmentOrigin,
    AppointmentStatus,
    Business,
    Service,
    User,
    UserRole,
)
from app.repositories import (
    appointments,
    catalog,
    professionals,
    time_blocks,
    working_hours,
)
from app.services.customer_link import notify_customer
from app.services.public_booking import (
    EXCLUSION_VIOLATION,
    build_access_url,
    eligible_ids,
)
from app.services.schedule import get_manageable

StaffEmailStatus = Literal["queued", "skipped", "none"]


@dataclass(frozen=True)
class StaffCustomer:
    name: str
    email: str | None
    phone: str | None


@dataclass(frozen=True)
class StaffAppointment:
    """D26: never the token hash nor the idempotency fields."""

    id: UUID
    professional_id: UUID
    service_id: UUID
    service_name: str
    starts_at: datetime
    ends_at: datetime
    blocked_until: datetime
    duration_minutes: int
    preparation_minutes: int
    price_cents: int
    status: AppointmentStatus
    origin: AppointmentOrigin
    customer_name: str
    customer_email: str | None
    customer_phone: str | None
    cancelled_at: datetime | None


@dataclass(frozen=True)
class CreatedAppointment:
    appointment: StaffAppointment
    access_url: str | None
    email_status: StaffEmailStatus


@dataclass(frozen=True)
class StaffChange:
    appointment: StaffAppointment
    email_status: StaffEmailStatus


def _view(appointment: Appointment, service_name: str) -> StaffAppointment:
    """The service name is the current one; the values are the copied ones (RN11)."""
    return StaffAppointment(
        id=appointment.id,
        professional_id=appointment.professional_id,
        service_id=appointment.service_id,
        service_name=service_name,
        starts_at=appointment.starts_at,
        ends_at=appointment.ends_at,
        blocked_until=appointment.blocked_until,
        duration_minutes=appointment.duration_minutes,
        preparation_minutes=appointment.preparation_minutes,
        price_cents=appointment.price_cents,
        status=appointment.status,
        origin=appointment.origin,
        customer_name=appointment.customer_name,
        customer_email=appointment.customer_email,
        customer_phone=appointment.customer_phone,
        cancelled_at=appointment.cancelled_at,
    )


async def _require_service(
    session: AsyncSession, business_id: UUID, service_id: UUID
) -> Service:
    service = await catalog.get(session, business_id, service_id)
    if service is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return service


async def _require_bookable(
    session: AsyncSession, business_id: UUID, service: Service, professional_id: UUID
) -> None:
    """D28: unlike the public side, the team knows inactive services, so 422."""
    if not service.is_active:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            invalid_field=("service_id", "this service is inactive"),
        )
    # RN07: the professional exists, so a refusal here is always 422.
    await eligible_ids(
        session, business_id, service.id, professional_id, invalid_location="body"
    )


async def _require_free(
    session: AsyncSession,
    business: Business,
    professional_id: UUID,
    starts_at: datetime,
    *,
    duration_minutes: int,
    preparation_minutes: int,
    now: datetime,
    excluding: UUID | None = None,
) -> datetime:
    """RN19: working hours, conflicts and blocks, as in the availability.

    Returns the end of the block. `excluding` is the appointment being
    rescheduled, which may overlap its own current time (D30).
    """
    blocked_until = block_end(starts_at, duration_minutes, preparation_minutes)
    intervals = await working_hours.list_for_professional(
        session, business.id, professional_id
    )
    if blocked_until is None or not fits_staff_hours(
        starts_at, blocked_until, intervals, ZoneInfo(business.timezone), now
    ):
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)
    booked = await appointments.busy_periods(
        session,
        business.id,
        [professional_id],
        starts_at,
        blocked_until,
        excluding=excluding,
    )
    blocked = await time_blocks.busy_periods(
        session, business.id, [professional_id], starts_at, blocked_until
    )
    busy = [*booked.get(professional_id, []), *blocked.get(professional_id, [])]
    if overlaps_any(starts_at, blocked_until, busy):
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)
    return blocked_until


async def _flush_or_unavailable(session: AsyncSession) -> None:
    """RN14: the exclusion constraint is the last defense, and the rollback
    discards the change, so a refused reschedule keeps the original time."""
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        if getattr(exc.orig, "sqlstate", None) == EXCLUSION_VIOLATION:
            raise AppError(ErrorCode.SLOT_UNAVAILABLE) from exc
        raise


async def _get_managed(
    session: AsyncSession, viewer: User, appointment_id: UUID, *, lock: bool
) -> Appointment:
    """Another business answers 404, and a colleague's agenda 403 (D27)."""
    business_id = viewer.business_id
    appointment = await (
        appointments.lock(session, business_id, appointment_id)
        if lock
        else appointments.get(session, business_id, appointment_id)
    )
    if appointment is None:
        raise AppError(ErrorCode.NOT_FOUND)
    # Under the lock, the professional is the current one, even after a move.
    await get_manageable(session, viewer, appointment.professional_id)
    return appointment


def _raise_if(refusal: ErrorCode | None) -> None:
    if refusal is not None:
        raise AppError(refusal)


def _is_confirmed(appointment: Appointment) -> bool:
    return appointment.status is AppointmentStatus.CONFIRMED


async def _service_name(session: AsyncSession, appointment: Appointment) -> str:
    service = await catalog.get(
        session, appointment.business_id, appointment.service_id
    )
    if service is None:  # The foreign key rules this out.
        raise AppError(ErrorCode.NOT_FOUND)
    return service.name


async def _people_name(
    session: AsyncSession, business_id: UUID, professional_id: UUID
) -> str:
    people = await professionals.list_with_users(
        session, business_id, professional_id=professional_id
    )
    if not people:  # The foreign key rules this out.
        raise AppError(ErrorCode.NOT_FOUND)
    return people[0][1].name


async def _email_payload(
    session: AsyncSession,
    business: Business,
    appointment: Appointment,
    service_name: str,
) -> dict[str, Any]:
    """D10 and D23: no customer name and no free text typed by the customer."""
    timezone = ZoneInfo(business.timezone)
    return {
        "business_name": business.name,
        "service_name": service_name,
        "professional_name": await _people_name(
            session, business.id, appointment.professional_id
        ),
        "starts_at": appointment.starts_at.astimezone(timezone).isoformat(),
    }


async def _notify(
    session: AsyncSession,
    settings: Settings,
    appointment: Appointment,
    template: EmailTemplate,
    payload: dict[str, Any],
    now: datetime,
) -> StaffEmailStatus:
    """D31: without an e-mail there is nobody to tell, so nothing is spent."""
    if appointment.customer_email is None:
        return "none"
    return await notify_customer(session, settings, appointment, template, payload, now)


async def list_agenda(
    session: AsyncSession,
    *,
    viewer: User,
    starts_at: datetime,
    ends_at: datetime,
    professional_id: UUID | None,
) -> list[StaffAppointment]:
    """D25: without a professional, all agendas for the Owner, the own one otherwise."""
    error = agenda_period_error(starts_at, ends_at)
    if error is not None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            invalid_field=("to", error),
            invalid_location="query",
        )
    business_id = viewer.business_id
    if professional_id is not None:
        await get_manageable(session, viewer, professional_id)
    elif viewer.role is not UserRole.OWNER:
        own = await professionals.get_by_user(session, business_id, viewer.id)
        if own is None:  # The invitation creates it with the account.
            raise AppError(ErrorCode.NOT_FOUND)
        professional_id = own.id
    rows = await appointments.list_in_period(
        session, business_id, starts_at, ends_at, professional_id=professional_id
    )
    return [_view(appointment, service_name) for appointment, service_name in rows]


async def create_manual(
    session: AsyncSession,
    settings: Settings,
    *,
    viewer: User,
    business: Business,
    professional_id: UUID,
    service_id: UUID,
    starts_at: datetime,
    customer: StaffCustomer,
    now: datetime,
) -> CreatedAppointment:
    """UC16: no grid, no advance limits and no Idempotency-Key (RN19, D28)."""
    business_id = viewer.business_id
    await get_manageable(session, viewer, professional_id)
    service = await _require_service(session, business_id, service_id)
    await _require_bookable(session, business_id, service, professional_id)
    await professionals.lock_many(session, business_id, [professional_id])

    # Everything read so far may have changed while this request waited.
    await session.refresh(business)
    await session.refresh(service)
    await _require_bookable(session, business_id, service, professional_id)
    blocked_until = await _require_free(
        session,
        business,
        professional_id,
        starts_at,
        duration_minutes=service.duration_minutes,
        preparation_minutes=service.preparation_minutes,
        now=now,
    )

    # D29: the link exists only with an e-mail to send it to.
    raw_token = None if customer.email is None else generate_opaque_token()
    appointment = Appointment(
        business_id=business_id,
        professional_id=professional_id,
        service_id=service.id,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=service.duration_minutes),
        blocked_until=blocked_until,
        duration_minutes=service.duration_minutes,
        preparation_minutes=service.preparation_minutes,
        price_cents=service.price_cents,
        customer_name=customer.name,
        customer_email=customer.email,
        customer_phone=customer.phone,
        status=AppointmentStatus.CONFIRMED,
        origin=AppointmentOrigin.STAFF,
        access_token_hash=None if raw_token is None else hash_opaque_token(raw_token),
        link_email_skipped=False,
    )
    session.add(appointment)
    await _flush_or_unavailable(session)

    access_url = None if raw_token is None else build_access_url(settings, raw_token)
    payload = await _email_payload(session, business, appointment, service.name)
    # After the insert, because these counters stay locked until the commit.
    email_status = await _notify(
        session,
        settings,
        appointment,
        EmailTemplate.APPOINTMENT_CONFIRMATION,
        {"url": access_url, **payload},
        now,
    )
    if email_status == "skipped":  # RN26: the link is only shown on the screen.
        appointment.link_email_skipped = True
    view = _view(appointment, service.name)
    await session.commit()
    return CreatedAppointment(view, access_url, email_status)


async def reschedule(
    session: AsyncSession,
    settings: Settings,
    *,
    viewer: User,
    business: Business,
    appointment_id: UUID,
    starts_at: datetime,
    professional_id: UUID | None,
    now: datetime,
) -> StaffChange:
    """UC17: the same row, service, copied values and link (RN11, RN18, D30).

    Locks the professionals before the appointment, like the customer's
    reschedule, so the two flows cannot deadlock each other.
    """
    business_id = viewer.business_id
    appointment = await _get_managed(session, viewer, appointment_id, lock=False)
    _raise_if(staff_change_refusal(is_confirmed=_is_confirmed(appointment)))
    if professional_id is not None:
        await get_manageable(session, viewer, professional_id)
    current_id = appointment.professional_id
    target_id = current_id if professional_id is None else professional_id
    service = await _require_service(session, business_id, appointment.service_id)
    await _require_bookable(session, business_id, service, target_id)
    locked_ids = sorted({current_id, target_id})
    await professionals.lock_many(session, business_id, locked_ids)

    appointment = await _get_managed(session, viewer, appointment_id, lock=True)
    await session.refresh(business)
    await session.refresh(service)
    _raise_if(staff_change_refusal(is_confirmed=_is_confirmed(appointment)))
    target_id = (
        appointment.professional_id if professional_id is None else professional_id
    )
    if target_id not in locked_ids:
        # A simultaneous change moved it to a professional this one did not lock.
        # Locking them now would take a professional after the appointment and
        # break the lock order, so the request is refused and nothing changes.
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)
    await _require_bookable(session, business_id, service, target_id)
    blocked_until = await _require_free(
        session,
        business,
        target_id,
        starts_at,
        duration_minutes=appointment.duration_minutes,
        preparation_minutes=appointment.preparation_minutes,
        now=now,
        excluding=appointment.id,
    )

    appointment.professional_id = target_id
    appointment.starts_at = starts_at
    appointment.ends_at = starts_at + timedelta(minutes=appointment.duration_minutes)
    appointment.blocked_until = blocked_until
    await _flush_or_unavailable(session)

    payload = await _email_payload(session, business, appointment, service.name)
    # D31: only the hash is stored, so the link cannot be rebuilt. The one the
    # customer already has still works (RN18), and the e-mail says so.
    email_status = await _notify(
        session,
        settings,
        appointment,
        EmailTemplate.APPOINTMENT_RESCHEDULE,
        {**payload, "link_still_valid": True},
        now,
    )
    view = _view(appointment, service.name)
    await session.commit()
    return StaffChange(view, email_status)


async def cancel(
    session: AsyncSession,
    settings: Settings,
    *,
    viewer: User,
    business: Business,
    appointment_id: UUID,
    now: datetime,
) -> StaffChange:
    """UC17: no deadline, even after the start; the lock serializes the status."""
    appointment = await _get_managed(session, viewer, appointment_id, lock=True)
    _raise_if(staff_change_refusal(is_confirmed=_is_confirmed(appointment)))

    appointment.status = AppointmentStatus.CANCELLED
    appointment.cancelled_at = now
    service_name = await _service_name(session, appointment)
    payload = await _email_payload(session, business, appointment, service_name)
    email_status = await _notify(
        session,
        settings,
        appointment,
        EmailTemplate.APPOINTMENT_CANCELLATION,
        payload,
        now,
    )
    view = _view(appointment, service_name)
    await session.commit()
    return StaffChange(view, email_status)


async def _record_outcome(
    session: AsyncSession,
    *,
    viewer: User,
    appointment_id: UUID,
    outcome: AppointmentStatus,
    now: datetime,
) -> StaffAppointment:
    """UC18: no e-mail, and the time stays occupied (RN15)."""
    appointment = await _get_managed(session, viewer, appointment_id, lock=True)
    _raise_if(
        outcome_refusal(
            is_confirmed=_is_confirmed(appointment),
            starts_at=appointment.starts_at,
            now=now,
        )
    )
    appointment.status = outcome
    view = _view(appointment, await _service_name(session, appointment))
    await session.commit()
    return view


async def complete(
    session: AsyncSession, *, viewer: User, appointment_id: UUID, now: datetime
) -> StaffAppointment:
    return await _record_outcome(
        session,
        viewer=viewer,
        appointment_id=appointment_id,
        outcome=AppointmentStatus.COMPLETED,
        now=now,
    )


async def mark_no_show(
    session: AsyncSession, *, viewer: User, appointment_id: UUID, now: datetime
) -> StaffAppointment:
    return await _record_outcome(
        session,
        viewer=viewer,
        appointment_id=appointment_id,
        outcome=AppointmentStatus.NO_SHOW,
        now=now,
    )
