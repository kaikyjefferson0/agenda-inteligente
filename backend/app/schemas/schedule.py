from datetime import UTC, datetime, time
from typing import Annotated, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    Field,
    PlainSerializer,
    StringConstraints,
    model_validator,
)

from app.domain.schedule import has_overlapping_intervals
from app.models import AppointmentStatus
from app.schemas.common import RequestModel, ResponseModel


def _validate_local_time(value: time) -> time:
    if value.tzinfo is not None:
        raise ValueError("working hours are in local time, without a time zone")
    if value.second or value.microsecond:
        raise ValueError("working hours must be in whole minutes")
    return value


def _to_utc(value: datetime) -> datetime:
    try:
        return value.astimezone(UTC)
    except OverflowError as exc:
        raise ValueError("date is out of range") from exc


LocalTime = Annotated[
    time,
    AfterValidator(_validate_local_time),
    PlainSerializer(lambda value: value.strftime("%H:%M"), return_type=str),
]
UtcInstant = Annotated[AwareDatetime, AfterValidator(_to_utc)]
BlockReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]


class AppointmentData(ResponseModel):
    """The format of `conflicts` and of `appointments_outside_hours`."""

    id: UUID
    professional_id: UUID
    service_id: UUID
    starts_at: datetime
    ends_at: datetime
    blocked_until: datetime
    status: AppointmentStatus
    customer_name: str


class WorkingHoursInterval(RequestModel):
    weekday: Annotated[int, Field(ge=0, le=6, description="0 é segunda, 6 é domingo")]
    start_time: LocalTime
    end_time: LocalTime

    @model_validator(mode="after")
    def _validate_order(self) -> Self:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class ReplaceWorkingHoursRequest(RequestModel):
    intervals: list[WorkingHoursInterval]

    @model_validator(mode="after")
    def _validate_no_overlap(self) -> Self:
        if has_overlapping_intervals(self.intervals):
            raise ValueError("intervals of the same weekday must not overlap")
        return self


class IntervalData(ResponseModel):
    weekday: int
    start_time: LocalTime
    end_time: LocalTime


class WorkingHoursResponse(ResponseModel):
    intervals: list[IntervalData]


class ReplaceWorkingHoursResponse(WorkingHoursResponse):
    appointments_outside_hours: list[AppointmentData]


class CreateTimeBlockRequest(RequestModel):
    starts_at: UtcInstant
    ends_at: UtcInstant
    reason: BlockReason

    @model_validator(mode="after")
    def _validate_order(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class TimeBlockData(ResponseModel):
    id: UUID
    professional_id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str
