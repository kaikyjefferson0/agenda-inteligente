from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_opaque_token
from app.domain.availability import is_on_grid, is_within_advance
from app.domain.customer_link import (
    can_cancel,
    can_reschedule,
    change_deadline_at,
    change_refusal,
    is_link_expired,
    is_token_well_formed,
)
from app.domain.errors import AppError, ErrorCode
from app.email.templates import EmailTemplate
from app.models import Appointment, AppointmentStatus, Business, Service
from app.repositories import appointments, businesses, catalog, professionals
from app.services.account_tokens import enqueue_email
from app.services.public_booking import (
    EXCLUSION_VIOLATION,
    PublicProfessional,
    build_access_url,
    choose_free_professional,
    eligible_ids,
    rules_of,
    slots_by_professional,
)
from app.services.rate_limits import consume_email_quota

ChangeEmailStatus = Literal["queued", "skipped"]


@dataclass(frozen=True)
class LinkBusiness:
    name: str
    slug: str
    timezone: str


@dataclass(frozen=True)
class LinkService:
    id: UUID
    name: str
    duration_minutes: int
    price_cents: int


@dataclass(frozen=True)
class CustomerAppointment:
    """D17: what the link shows. Nothing about the customer."""

    id: UUID
    status: AppointmentStatus
    starts_at: datetime
    ends_at: datetime
    business: LinkBusiness
    service: LinkService
    professional: PublicProfessional
    can_cancel: bool
    can_reschedule: bool
    change_deadline_at: datetime


@dataclass(frozen=True)
class CustomerChange:
    appointment: CustomerAppointment
    email_status: ChangeEmailStatus


async def _find(
    session: AsyncSession, token: str, now: datetime, *, lock: bool
) -> Appointment:
    """D18: unknown, malformed, replaced and expired links answer the same 404."""
    if not is_token_well_formed(token):
        raise AppError(ErrorCode.NOT_FOUND)
    token_hash = hash_opaque_token(token)
    appointment = await (
        appointments.lock_by_access_token_hash(session, token_hash)
        if lock
        else appointments.get_by_access_token_hash(session, token_hash)
    )
    if appointment is None or is_link_expired(appointment.starts_at, now):
        raise AppError(ErrorCode.NOT_FOUND)
    return appointment


async def _business_of(session: AsyncSession, appointment: Appointment) -> Business:
    business = await businesses.get_by_id(session, appointment.business_id)
    if business is None:  # The foreign key rules this out.
        raise AppError(ErrorCode.NOT_FOUND)
    return business


async def _service_of(
    session: AsyncSession, business: Business, appointment: Appointment
) -> Service:
    service = await catalog.get(session, business.id, appointment.service_id)
    if service is None:  # The foreign key rules this out.
        raise AppError(ErrorCode.NOT_FOUND)
    return service


def _require_changeable(
    appointment: Appointment, business: Business, now: datetime
) -> None:
    """D19: the status first, then the deadline of RN17."""
    refusal = change_refusal(
        is_confirmed=appointment.status is AppointmentStatus.CONFIRMED,
        starts_at=appointment.starts_at,
        change_deadline_minutes=business.change_deadline_minutes,
        now=now,
    )
    if refusal is not None:
        raise AppError(refusal)


def _require_reschedulable(service: Service) -> None:
    """D21: a deactivated service offers no times, so no new time is free."""
    if not service.is_active:
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)


async def _describe(
    session: AsyncSession,
    business: Business,
    appointment: Appointment,
    service: Service,
    now: datetime,
) -> CustomerAppointment:
    """The service name is the current one; duration and price are copied (RN11)."""
    people = await professionals.list_with_users(
        session, business.id, professional_id=appointment.professional_id
    )
    if not people:  # The foreign key rules this out.
        raise AppError(ErrorCode.NOT_FOUND)
    timezone = ZoneInfo(business.timezone)
    is_confirmed = appointment.status is AppointmentStatus.CONFIRMED
    deadline_minutes = business.change_deadline_minutes
    return CustomerAppointment(
        id=appointment.id,
        status=appointment.status,
        starts_at=appointment.starts_at.astimezone(timezone),
        ends_at=appointment.ends_at.astimezone(timezone),
        business=LinkBusiness(
            name=business.name, slug=business.slug, timezone=business.timezone
        ),
        service=LinkService(
            id=service.id,
            name=service.name,
            duration_minutes=appointment.duration_minutes,
            price_cents=appointment.price_cents,
        ),
        professional=PublicProfessional(
            id=appointment.professional_id, name=people[0][1].name
        ),
        can_cancel=can_cancel(
            is_confirmed=is_confirmed,
            starts_at=appointment.starts_at,
            change_deadline_minutes=deadline_minutes,
            now=now,
        ),
        can_reschedule=can_reschedule(
            is_confirmed=is_confirmed,
            starts_at=appointment.starts_at,
            change_deadline_minutes=deadline_minutes,
            service_is_active=service.is_active,
            now=now,
        ),
        change_deadline_at=change_deadline_at(
            appointment.starts_at, deadline_minutes
        ).astimezone(timezone),
    )


async def _notify(
    session: AsyncSession,
    settings: Settings,
    appointment: Appointment,
    template: EmailTemplate,
    payload: dict[str, Any],
    now: datetime,
) -> ChangeEmailStatus:
    """RN25 and RN26: above the limits the change stays, and nothing is queued."""
    recipient = appointment.customer_email
    if recipient is None or not await consume_email_quota(
        session, settings, recipient, now
    ):
        return "skipped"
    enqueue_email(session, recipient, template, payload)
    return "queued"


def _email_payload(described: CustomerAppointment) -> dict[str, Any]:
    """D23: like the creation e-mail (D10), without the customer's name."""
    return {
        "business_name": described.business.name,
        "service_name": described.service.name,
        "professional_name": described.professional.name,
        "starts_at": described.starts_at.isoformat(),
    }


async def get_by_token(
    session: AsyncSession, *, token: str, now: datetime
) -> CustomerAppointment:
    appointment = await _find(session, token, now, lock=False)
    business = await _business_of(session, appointment)
    service = await _service_of(session, business, appointment)
    return await _describe(session, business, appointment, service, now)


async def cancel_by_token(
    session: AsyncSession, settings: Settings, *, token: str, now: datetime
) -> CustomerChange:
    """RN15 and RN17, checked under the lock, so two cancellations are serialized."""
    appointment = await _find(session, token, now, lock=True)
    business = await _business_of(session, appointment)
    _require_changeable(appointment, business, now)

    appointment.status = AppointmentStatus.CANCELLED
    appointment.cancelled_at = now
    service = await _service_of(session, business, appointment)
    described = await _describe(session, business, appointment, service, now)
    email_status = await _notify(
        session,
        settings,
        appointment,
        EmailTemplate.APPOINTMENT_CANCELLATION,
        _email_payload(described),
        now,
    )
    await session.commit()
    return CustomerChange(described, email_status)


async def reschedule_by_token(
    session: AsyncSession,
    settings: Settings,
    *,
    token: str,
    starts_at: datetime,
    professional_id: UUID | None,
    now: datetime,
) -> CustomerChange:
    """RN18: an atomic swap in the same row, with the same link and copied values.

    Locks the professionals before the appointment, in the order of the booking
    and of its idempotent repeat, so these flows cannot deadlock each other.
    """
    appointment = await _find(session, token, now, lock=False)
    business = await _business_of(session, appointment)
    _require_changeable(appointment, business, now)
    service = await _service_of(session, business, appointment)
    _require_reschedulable(service)
    candidates = await eligible_ids(
        session, business.id, service.id, professional_id, invalid_location="body"
    )
    await professionals.lock_many(session, business.id, candidates)

    # Everything read so far may have changed while this request waited for the
    # locks, including the token, which a repeat of the booking may replace.
    appointment = await _find(session, token, now, lock=True)
    await session.refresh(business)
    await session.refresh(service)
    _require_changeable(appointment, business, now)
    _require_reschedulable(service)
    candidates = await eligible_ids(
        session, business.id, service.id, professional_id, invalid_location="body"
    )

    rules = rules_of(business)
    instant = starts_at.astimezone(UTC)
    # First, because an extreme date cannot be converted to the local clock.
    if not is_within_advance(instant, rules, now):
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)
    if not is_on_grid(instant, rules):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            invalid_field=("starts_at", "this time is not on the grid"),
        )

    # The appointment itself stays busy, so a time over the current one is refused.
    slots = await slots_by_professional(
        session,
        business=business,
        duration_minutes=appointment.duration_minutes,
        preparation_minutes=appointment.preparation_minutes,
        professional_ids=candidates,
        day=instant.astimezone(rules.timezone).date(),
        now=now,
    )
    free_ids = [
        candidate for candidate in candidates if instant in slots.get(candidate, [])
    ]
    if not free_ids:
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)
    chosen = (
        professional_id
        if professional_id is not None
        else await choose_free_professional(
            session,
            business_id=business.id,
            service_id=service.id,
            timezone=rules.timezone,
            free_ids=free_ids,
            starts_at=instant,
            excluding=appointment.id,
        )
    )

    ends_at = instant + timedelta(minutes=appointment.duration_minutes)
    appointment.professional_id = chosen
    appointment.starts_at = instant
    appointment.ends_at = ends_at
    appointment.blocked_until = ends_at + timedelta(
        minutes=appointment.preparation_minutes
    )
    try:
        await session.flush()
    except IntegrityError as exc:
        # The rollback discards the swap, so the original time stays (CT13).
        await session.rollback()
        if getattr(exc.orig, "sqlstate", None) == EXCLUSION_VIOLATION:
            raise AppError(ErrorCode.SLOT_UNAVAILABLE) from exc
        raise

    described = await _describe(session, business, appointment, service, now)
    email_status = await _notify(
        session,
        settings,
        appointment,
        EmailTemplate.APPOINTMENT_RESCHEDULE,
        # The link stays the same (RN18), so the token received rebuilds it.
        {"url": build_access_url(settings, token), **_email_payload(described)},
        now,
    )
    await session.commit()
    return CustomerChange(described, email_status)
