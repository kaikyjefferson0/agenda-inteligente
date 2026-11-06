from typing import Annotated, Literal, cast
from uuid import UUID

from pydantic import Field

from app.domain.business import (
    MAX_ADVANCE_DAYS,
    MAX_CHANGE_DEADLINE_MINUTES,
    MAX_MIN_ADVANCE_MINUTES,
)
from app.schemas.common import (
    Name,
    RequestModel,
    ResponseModel,
    Slug,
    TimeZoneName,
)
from app.schemas.schedule import AppointmentData

SlotStep = Literal[5, 10, 15, 20, 30, 60]  # RN01
MinAdvance = Annotated[int, Field(ge=0, le=MAX_MIN_ADVANCE_MINUTES)]
MaxAdvance = Annotated[int, Field(ge=1, le=MAX_ADVANCE_DAYS)]
ChangeDeadline = Annotated[int, Field(ge=0, le=MAX_CHANGE_DEADLINE_MINUTES)]


class UpdateBusinessRequest(RequestModel):
    name: Name = Field(default=cast(Name, None))
    slug: Slug = Field(default=cast(Slug, None))
    timezone: TimeZoneName = Field(default=cast(TimeZoneName, None))
    slot_step_minutes: SlotStep = Field(default=cast(SlotStep, None))
    min_advance_minutes: MinAdvance = Field(default=cast(MinAdvance, None))
    max_advance_days: MaxAdvance = Field(default=cast(MaxAdvance, None))
    change_deadline_minutes: ChangeDeadline = Field(default=cast(ChangeDeadline, None))


class BusinessData(ResponseModel):
    id: UUID
    name: str
    slug: str
    timezone: str
    slot_step_minutes: int
    min_advance_minutes: int
    max_advance_days: int
    change_deadline_minutes: int
    is_demo: bool


class UpdateBusinessResponse(BusinessData):
    appointments_outside_hours: list[AppointmentData]
