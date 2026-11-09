from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, EmailStr, Field

from app.domain.staff_appointments import is_whole_minute
from app.models import AppointmentOrigin, AppointmentStatus
from app.schemas.common import CustomerName, CustomerPhone, RequestModel, ResponseModel
from app.schemas.schedule import UtcInstant

StaffEmailStatus = Literal["queued", "skipped", "none"]


def _require_whole_minute(value: datetime) -> datetime:
    if not is_whole_minute(value):
        raise ValueError("must be a whole minute, without seconds")
    return value


# D28: no grid for the team, but always a whole minute.
StaffInstant = Annotated[UtcInstant, AfterValidator(_require_whole_minute)]


class StaffCustomerData(RequestModel):
    """D28: only the name is required, with the rules of the public page (D9)."""

    name: CustomerName
    email: EmailStr | None = None
    phone: CustomerPhone | None = None


class CreateAppointmentRequest(RequestModel):
    professional_id: UUID
    service_id: UUID
    starts_at: StaffInstant
    customer: StaffCustomerData


class StaffRescheduleRequest(RequestModel):
    starts_at: StaffInstant
    professional_id: UUID | None = Field(
        default=None, description="Ausente ou nulo mantém o profissional atual"
    )


class StaffAppointmentData(ResponseModel):
    """D26: what the team sees in the agenda, with the instants in UTC."""

    id: UUID
    professional_id: UUID
    service_id: UUID
    service_name: str = Field(description="Nome atual do serviço")
    starts_at: datetime
    ends_at: datetime
    blocked_until: datetime
    duration_minutes: int = Field(description="Copiada do agendamento (RN11)")
    preparation_minutes: int = Field(description="Copiado do agendamento (RN11)")
    price_cents: int = Field(description="Copiado do agendamento (RN11)")
    status: AppointmentStatus
    origin: AppointmentOrigin
    customer_name: str
    customer_email: str | None
    customer_phone: str | None
    cancelled_at: datetime | None


class CreatedAppointmentResponse(StaffAppointmentData):
    access_url: str | None = Field(description="Nulo quando não há e-mail (D29)")
    email_status: StaffEmailStatus


class StaffChangeResponse(StaffAppointmentData):
    email_status: StaffEmailStatus
