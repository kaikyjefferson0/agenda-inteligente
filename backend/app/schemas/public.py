from datetime import UTC, datetime
from datetime import date as LocalDate
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    EmailStr,
    Field,
)

from app.models import AppointmentStatus
from app.schemas.common import CustomerName, CustomerPhone, RequestModel

# The format of the example in the API document. Any version of UUID is accepted.
IDEMPOTENCY_KEY_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _ensure_convertible(value: datetime) -> datetime:
    """Keeps the offset, which is part of the data that identifies a request."""
    try:
        value.astimezone(UTC)
    except OverflowError as exc:
        raise ValueError("date is out of range") from exc
    return value


BookingInstant = Annotated[AwareDatetime, AfterValidator(_ensure_convertible)]


class CustomerData(RequestModel):
    name: CustomerName
    email: EmailStr
    phone: CustomerPhone


class CreateBookingRequest(RequestModel):
    service_id: UUID
    professional_id: UUID | None = None
    starts_at: BookingInstant
    customer: CustomerData


class PublicServiceData(BaseModel):
    id: UUID
    name: str
    duration_minutes: int
    price_cents: int
    professional_ids: list[UUID]


class PublicProfessionalData(BaseModel):
    id: UUID
    name: str


class PublicBusinessResponse(BaseModel):
    name: str
    slug: str
    timezone: str
    is_demo: bool
    min_advance_minutes: int
    max_advance_days: int
    services: list[PublicServiceData]
    professionals: list[PublicProfessionalData]


class SlotData(BaseModel):
    starts_at: datetime


class AvailabilityResponse(BaseModel):
    date: LocalDate
    slots: list[SlotData]


class BookedServiceData(BaseModel):
    name: str
    price_cents: int


class BookedProfessionalData(BaseModel):
    name: str


class BookingResponse(BaseModel):
    id: UUID
    status: AppointmentStatus
    starts_at: datetime
    ends_at: datetime
    service: BookedServiceData
    professional: BookedProfessionalData
    access_url: str | None = Field(
        description="Nulo em uma repetição: o token só existe em forma de hash"
    )
    email_status: Literal["queued", "skipped", "unchanged"]


class RescheduleRequest(RequestModel):
    starts_at: BookingInstant
    professional_id: UUID | None = None


class LinkBusinessData(BaseModel):
    name: str
    slug: str
    timezone: str


class LinkServiceData(BaseModel):
    id: UUID
    name: str
    duration_minutes: int = Field(description="Copiada do agendamento (RN11)")
    price_cents: int = Field(description="Copiado do agendamento (RN11)")


class LinkProfessionalData(BaseModel):
    id: UUID
    name: str


class CustomerAppointmentResponse(BaseModel):
    """Sem nenhum dado do cliente: nem nome, nem e-mail, nem telefone."""

    id: UUID
    status: AppointmentStatus
    starts_at: datetime
    ends_at: datetime
    business: LinkBusinessData
    service: LinkServiceData
    professional: LinkProfessionalData
    can_cancel: bool
    can_reschedule: bool
    change_deadline_at: datetime = Field(
        description="Início atual menos o prazo de alteração do negócio (RN17)"
    )


class CustomerChangeResponse(CustomerAppointmentResponse):
    email_status: Literal["queued", "skipped"]
