from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import generate_opaque_token, hash_opaque_token
from app.domain.availability import (
    BookingRules,
    available_slots,
    is_day_within_advance,
    is_on_grid,
    is_within_advance,
    local_day_bounds,
)
from app.domain.booking import (
    BookingCandidate,
    booking_fingerprint,
    choose_professional,
)
from app.domain.errors import AppError, ErrorCode
from app.domain.schedule import WeeklyInterval
from app.email.templates import EmailTemplate
from app.models import (
    Appointment,
    AppointmentOrigin,
    AppointmentStatus,
    Business,
    Service,
)
from app.repositories import (
    appointments,
    businesses,
    catalog,
    professionals,
    time_blocks,
    working_hours,
)
from app.services.account_tokens import enqueue_email
from app.services.rate_limits import consume_email_quota

EXCLUSION_VIOLATION = "23P01"
IDEMPOTENCY_INDEX = "uq_appointments_business_id_idempotency_key"

EmailStatus = Literal["queued", "skipped", "unchanged"]


@dataclass(frozen=True)
class PublicProfessional:
    id: UUID
    name: str


@dataclass(frozen=True)
class PublicService:
    id: UUID
    name: str
    duration_minutes: int
    price_cents: int
    professional_ids: list[UUID]


@dataclass(frozen=True)
class PublicBusiness:
    name: str
    slug: str
    timezone: str
    is_demo: bool
    min_advance_minutes: int
    max_advance_days: int
    services: list[PublicService]
    professionals: list[PublicProfessional]


@dataclass(frozen=True)
class Availability:
    day: date
    slots: list[datetime]


@dataclass(frozen=True)
class CustomerContact:
    name: str
    email: str
    phone: str


@dataclass(frozen=True)
class BookingOutcome:
    id: UUID
    status: AppointmentStatus
    starts_at: datetime
    ends_at: datetime
    service_name: str
    price_cents: int
    professional_name: str
    access_url: str | None
    email_status: EmailStatus
    created: bool


def rules_of(business: Business) -> BookingRules:
    return BookingRules(
        timezone=ZoneInfo(business.timezone),
        slot_step_minutes=business.slot_step_minutes,
        min_advance_minutes=business.min_advance_minutes,
        max_advance_days=business.max_advance_days,
    )


def build_access_url(settings: Settings, raw_token: str) -> str:
    return f"{settings.frontend_base_url}/agendamento/{raw_token}"


async def _require_business(session: AsyncSession, slug: str) -> Business:
    # PostgreSQL text cannot hold a null character, and no slug has one.
    business = None if "\x00" in slug else await businesses.get_by_slug(session, slug)
    if business is None:
        raise AppError(ErrorCode.NOT_FOUND)
    return business


async def _require_active_service(
    session: AsyncSession, business_id: UUID, service_id: UUID
) -> Service:
    """The public side only knows active services, so inactive also answers 404."""
    service = await catalog.get(session, business_id, service_id)
    if service is None or not service.is_active:
        raise AppError(ErrorCode.NOT_FOUND)
    return service


async def eligible_ids(
    session: AsyncSession,
    business_id: UUID,
    service_id: UUID,
    professional_id: UUID | None,
    *,
    invalid_location: str,
) -> list[UUID]:
    """RN07: everyone eligible, or the chosen professional if there is a choice."""
    eligible = [
        professional.id
        for professional in await professionals.list_eligible(
            session, business_id, service_id
        )
    ]
    if professional_id is None:
        return eligible
    if professional_id in eligible:
        return [professional_id]
    if await professionals.get(session, business_id, professional_id) is None:
        raise AppError(ErrorCode.NOT_FOUND)
    raise AppError(
        ErrorCode.VALIDATION_ERROR,
        invalid_field=("professional_id", "this professional cannot be booked"),
        invalid_location=invalid_location,
    )


async def slots_by_professional(
    session: AsyncSession,
    *,
    business: Business,
    duration_minutes: int,
    preparation_minutes: int,
    professional_ids: Sequence[UUID],
    day: date,
    now: datetime,
) -> dict[UUID, list[datetime]]:
    """The free times of each professional for a block of this size.

    A reschedule passes the values copied to the appointment (RN11), and its own
    appointment still counts as busy (RN18).
    """
    rules = rules_of(business)
    if not professional_ids or not is_day_within_advance(day, rules, now):
        return {}

    day_start, day_end = local_day_bounds(day, rules.timezone)
    hours: dict[UUID, list[WeeklyInterval]] = defaultdict(list)
    for row in await working_hours.list_for_business(session, business.id):
        hours[row.professional_id].append(row)
    booked = await appointments.busy_periods(
        session, business.id, professional_ids, day_start, day_end
    )
    blocked = await time_blocks.busy_periods(
        session, business.id, professional_ids, day_start, day_end
    )
    return {
        professional_id: available_slots(
            day,
            rules=rules,
            intervals=hours[professional_id],
            busy=[*booked.get(professional_id, []), *blocked.get(professional_id, [])],
            duration_minutes=duration_minutes,
            preparation_minutes=preparation_minutes,
            now=now,
        )
        for professional_id in professional_ids
    }


async def get_public_business(session: AsyncSession, slug: str) -> PublicBusiness:
    business = await _require_business(session, slug)
    names: dict[UUID, str] = {}
    serving: dict[UUID, list[UUID]] = defaultdict(list)
    links = await professionals.list_public_links(session, business.id)
    for professional_id, name, service_id in links:
        names[professional_id] = name
        serving[service_id].append(professional_id)
    active_services = await catalog.list_active(session, business.id)
    return PublicBusiness(
        name=business.name,
        slug=business.slug,
        timezone=business.timezone,
        is_demo=business.is_demo,
        min_advance_minutes=business.min_advance_minutes,
        max_advance_days=business.max_advance_days,
        services=[
            PublicService(
                id=service.id,
                name=service.name,
                duration_minutes=service.duration_minutes,
                price_cents=service.price_cents,
                professional_ids=serving[service.id],
            )
            for service in active_services
        ],
        professionals=[
            PublicProfessional(id=professional_id, name=name)
            for professional_id, name in names.items()
        ],
    )


async def get_availability(
    session: AsyncSession,
    *,
    slug: str,
    service_id: UUID,
    day: date,
    professional_id: UUID | None,
    now: datetime,
) -> Availability:
    """With no professional, gathers the times of everyone eligible."""
    business = await _require_business(session, slug)
    service = await _require_active_service(session, business.id, service_id)
    professional_ids = await eligible_ids(
        session, business.id, service.id, professional_id, invalid_location="query"
    )
    slots = await slots_by_professional(
        session,
        business=business,
        duration_minutes=service.duration_minutes,
        preparation_minutes=service.preparation_minutes,
        professional_ids=professional_ids,
        day=day,
        now=now,
    )
    merged = {slot for found in slots.values() for slot in found}
    timezone = ZoneInfo(business.timezone)
    return Availability(day, [slot.astimezone(timezone) for slot in sorted(merged)])


async def _describe(
    session: AsyncSession,
    business: Business,
    appointment: Appointment,
    *,
    access_url: str | None,
    email_status: EmailStatus,
    created: bool,
) -> BookingOutcome:
    """The service name is the current one: only the values are copied (RN11)."""
    service = await catalog.get(session, business.id, appointment.service_id)
    people = await professionals.list_with_users(
        session, business.id, professional_id=appointment.professional_id
    )
    if service is None or not people:  # The foreign keys rule this out.
        raise AppError(ErrorCode.NOT_FOUND)
    timezone = ZoneInfo(business.timezone)
    return BookingOutcome(
        id=appointment.id,
        status=appointment.status,
        starts_at=appointment.starts_at.astimezone(timezone),
        ends_at=appointment.ends_at.astimezone(timezone),
        service_name=service.name,
        price_cents=appointment.price_cents,
        professional_name=people[0][1].name,
        access_url=access_url,
        email_status=email_status,
        created=created,
    )


async def _replay(
    session: AsyncSession,
    settings: Settings,
    business: Business,
    idempotency_key: str,
    fingerprint: str,
) -> BookingOutcome | None:
    """RN13: None if the key is new. Otherwise, the appointment it already created.

    Comes before every booking rule, so a retry still gets its appointment after
    the service was deactivated or the time left the advance window.
    """
    existing = await appointments.get_by_idempotency_key(
        session, business.id, idempotency_key
    )
    if existing is None:
        return None
    if existing.idempotency_fingerprint != fingerprint:
        raise AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED)

    access_url: str | None = None
    email_status: EmailStatus = "unchanged"
    if existing.link_email_skipped:
        # Of two simultaneous retries, only the link of the last one stays valid.
        locked = await appointments.lock(session, business.id, existing.id)
        if locked is None:  # Appointments are never deleted by a request.
            raise AppError(ErrorCode.NOT_FOUND)
        raw_token = generate_opaque_token()
        locked.access_token_hash = hash_opaque_token(raw_token)
        access_url = build_access_url(settings, raw_token)
        email_status = "skipped"
    outcome = await _describe(
        session,
        business,
        existing,
        access_url=access_url,
        email_status=email_status,
        created=False,
    )
    # Also releases any professional locked by a request that lost the race.
    await session.commit()
    return outcome


async def choose_free_professional(
    session: AsyncSession,
    *,
    business_id: UUID,
    service_id: UUID,
    timezone: ZoneInfo,
    free_ids: Sequence[UUID],
    starts_at: datetime,
    excluding: UUID | None = None,
) -> UUID:
    """RN10: only consulted among those eligible and free at the requested time.

    `excluding` is the appointment being rescheduled, left out of the count (D20).
    """
    day_start, day_end = local_day_bounds(
        starts_at.astimezone(timezone).date(), timezone
    )
    counts = await appointments.count_by_professional(
        session, business_id, free_ids, day_start, day_end, excluding=excluding
    )
    eligible = await professionals.list_eligible(session, business_id, service_id)
    chosen = choose_professional(
        BookingCandidate(
            professional_id=professional.id,
            registered_at=professional.created_at,
            appointments_that_day=counts.get(professional.id, 0),
        )
        for professional in eligible
        if professional.id in free_ids
    )
    if chosen is None:
        raise AppError(ErrorCode.SLOT_UNAVAILABLE)
    return chosen


async def create_booking(
    session: AsyncSession,
    settings: Settings,
    *,
    slug: str,
    idempotency_key: str,
    service_id: UUID,
    professional_id: UUID | None,
    starts_at: datetime,
    customer: CustomerContact,
    now: datetime,
) -> BookingOutcome:
    business = await _require_business(session, slug)
    fingerprint = booking_fingerprint(
        service_id=service_id,
        professional_id=professional_id,
        starts_at=starts_at,
        customer_name=customer.name,
        customer_email=customer.email,
        customer_phone=customer.phone,
    )
    replayed = await _replay(session, settings, business, idempotency_key, fingerprint)
    if replayed is not None:
        return replayed

    service = await _require_active_service(session, business.id, service_id)
    candidates = await eligible_ids(
        session, business.id, service.id, professional_id, invalid_location="body"
    )
    await professionals.lock_many(session, business.id, candidates)

    # Everything read so far may have changed while this request waited for the
    # locks. The key above all: whoever lost a race with the same key would find
    # the time taken and answer 409, instead of returning the appointment.
    replayed = await _replay(session, settings, business, idempotency_key, fingerprint)
    if replayed is not None:
        return replayed
    await session.refresh(business)
    await session.refresh(service)
    if not service.is_active:
        raise AppError(ErrorCode.NOT_FOUND)
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

    slots = await slots_by_professional(
        session,
        business=business,
        duration_minutes=service.duration_minutes,
        preparation_minutes=service.preparation_minutes,
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
        )
    )

    raw_token = generate_opaque_token()
    ends_at = instant + timedelta(minutes=service.duration_minutes)
    appointment = Appointment(
        business_id=business.id,
        professional_id=chosen,
        service_id=service.id,
        starts_at=instant,
        ends_at=ends_at,
        blocked_until=ends_at + timedelta(minutes=service.preparation_minutes),
        duration_minutes=service.duration_minutes,
        preparation_minutes=service.preparation_minutes,
        price_cents=service.price_cents,
        customer_name=customer.name,
        customer_email=customer.email,
        customer_phone=customer.phone,
        status=AppointmentStatus.CONFIRMED,
        origin=AppointmentOrigin.PUBLIC,
        access_token_hash=hash_opaque_token(raw_token),
        link_email_skipped=False,
        idempotency_key=idempotency_key,
        idempotency_fingerprint=fingerprint,
    )
    session.add(appointment)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        if getattr(exc.orig, "sqlstate", None) == EXCLUSION_VIOLATION:
            raise AppError(ErrorCode.SLOT_UNAVAILABLE) from exc
        if IDEMPOTENCY_INDEX not in str(exc.orig):
            raise
        # The rollback expired everything loaded by this session.
        await session.refresh(business)
        replayed = await _replay(
            session, settings, business, idempotency_key, fingerprint
        )
        if replayed is None:  # The appointment that broke the index was committed.
            raise
        return replayed

    outcome = await _describe(
        session,
        business,
        appointment,
        access_url=build_access_url(settings, raw_token),
        email_status="queued",
        created=True,
    )
    # After the insert, because these counters stay locked until the commit.
    if await consume_email_quota(session, settings, customer.email, now):
        enqueue_email(
            session,
            customer.email,
            EmailTemplate.APPOINTMENT_CONFIRMATION,
            {
                "url": outcome.access_url,
                "business_name": business.name,
                "service_name": outcome.service_name,
                "professional_name": outcome.professional_name,
                "starts_at": outcome.starts_at.isoformat(),
            },
        )
    else:  # RN26: the appointment stays, and the link is only shown on the screen.
        appointment.link_email_skipped = True
        outcome = replace(outcome, email_status="skipped")
    await session.commit()
    return outcome
