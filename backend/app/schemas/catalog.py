from typing import Annotated
from uuid import UUID

from pydantic import Field

from app.domain.business import (
    MAX_SERVICE_DURATION_MINUTES,
    MAX_SERVICE_PREPARATION_MINUTES,
    MAX_SERVICE_PRICE_CENTS,
)
from app.schemas.common import Name, RequestModel, ResponseModel

Duration = Annotated[int, Field(ge=1, le=MAX_SERVICE_DURATION_MINUTES)]
Preparation = Annotated[int, Field(ge=0, le=MAX_SERVICE_PREPARATION_MINUTES)]
Price = Annotated[int, Field(ge=0, le=MAX_SERVICE_PRICE_CENTS)]


class CreateServiceRequest(RequestModel):
    name: Name
    duration_minutes: Duration
    preparation_minutes: Preparation = 0
    price_cents: Price


class UpdateServiceRequest(RequestModel):
    name: Name = Field(default=None)
    duration_minutes: Duration = Field(default=None)
    preparation_minutes: Preparation = Field(default=None)
    price_cents: Price = Field(default=None)
    is_active: bool = Field(default=None)


class ServiceData(ResponseModel):
    id: UUID
    name: str
    duration_minutes: int
    preparation_minutes: int
    price_cents: int
    is_active: bool
