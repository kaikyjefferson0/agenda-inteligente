from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status

from app.api.deps import NowDep, SessionDep, SettingsDep, limited_by_ip
from app.domain.rate_limits import (
    PUBLIC_AVAILABILITY_BY_IP,
    PUBLIC_BOOKING_BY_IP,
    PUBLIC_BUSINESS_BY_IP,
)
from app.schemas.public import (
    IDEMPOTENCY_KEY_PATTERN,
    AvailabilityResponse,
    BookedProfessionalData,
    BookedServiceData,
    BookingResponse,
    CreateBookingRequest,
    PublicBusinessResponse,
    PublicProfessionalData,
    PublicServiceData,
    SlotData,
)
from app.services import public_booking
from app.services.public_booking import CustomerContact

router = APIRouter(prefix="/public/businesses", tags=["public"])


@router.get("/{slug}", dependencies=[limited_by_ip(PUBLIC_BUSINESS_BY_IP)])
async def get_public_business(slug: str, session: SessionDep) -> PublicBusinessResponse:
    business = await public_booking.get_public_business(session, slug)
    return PublicBusinessResponse(
        name=business.name,
        slug=business.slug,
        timezone=business.timezone,
        is_demo=business.is_demo,
        min_advance_minutes=business.min_advance_minutes,
        max_advance_days=business.max_advance_days,
        services=[
            PublicServiceData(
                id=service.id,
                name=service.name,
                duration_minutes=service.duration_minutes,
                price_cents=service.price_cents,
                professional_ids=service.professional_ids,
            )
            for service in business.services
        ],
        professionals=[
            PublicProfessionalData(id=professional.id, name=professional.name)
            for professional in business.professionals
        ],
    )


@router.get(
    "/{slug}/availability", dependencies=[limited_by_ip(PUBLIC_AVAILABILITY_BY_IP)]
)
async def get_availability(
    slug: str,
    service_id: UUID,
    day: Annotated[date, Query(alias="date")],
    session: SessionDep,
    now: NowDep,
    professional_id: UUID | None = None,
) -> AvailabilityResponse:
    availability = await public_booking.get_availability(
        session,
        slug=slug,
        service_id=service_id,
        day=day,
        professional_id=professional_id,
        now=now,
    )
    return AvailabilityResponse(
        date=availability.day,
        slots=[SlotData(starts_at=slot) for slot in availability.slots],
    )


@router.post(
    "/{slug}/appointments",
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_200_OK: {"description": "Repetição idempotente"}},
    dependencies=[limited_by_ip(PUBLIC_BOOKING_BY_IP)],
)
async def create_booking(
    slug: str,
    body: CreateBookingRequest,
    idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", pattern=IDEMPOTENCY_KEY_PATTERN)
    ],
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
) -> BookingResponse:
    outcome = await public_booking.create_booking(
        session,
        settings,
        slug=slug,
        # The same UUID in another case must not count as a new key.
        idempotency_key=idempotency_key.lower(),
        service_id=body.service_id,
        professional_id=body.professional_id,
        starts_at=body.starts_at,
        customer=CustomerContact(
            name=body.customer.name,
            email=body.customer.email,
            phone=body.customer.phone,
        ),
        now=now,
    )
    if not outcome.created:
        response.status_code = status.HTTP_200_OK
    return BookingResponse(
        id=outcome.id,
        status=outcome.status,
        starts_at=outcome.starts_at,
        ends_at=outcome.ends_at,
        service=BookedServiceData(
            name=outcome.service_name, price_cents=outcome.price_cents
        ),
        professional=BookedProfessionalData(name=outcome.professional_name),
        access_url=outcome.access_url,
        email_status=outcome.email_status,
    )
