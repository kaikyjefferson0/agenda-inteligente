from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentSessionDep, NowDep, SessionDep, SettingsDep
from app.schemas.appointments import (
    CreateAppointmentRequest,
    CreatedAppointmentResponse,
    StaffAppointmentData,
    StaffChangeResponse,
    StaffRescheduleRequest,
)
from app.schemas.schedule import UtcInstant
from app.services import staff_appointments
from app.services.staff_appointments import StaffChange, StaffCustomer

# D33: authenticated, so no limit by IP, like the other administration routes.
router = APIRouter(prefix="/appointments", tags=["appointments"])


def _change_response(change: StaffChange) -> StaffChangeResponse:
    return StaffChangeResponse.model_validate(
        {
            **StaffAppointmentData.model_validate(change.appointment).model_dump(),
            "email_status": change.email_status,
        }
    )


@router.get("")
async def list_agenda(
    starts_at: Annotated[UtcInstant, Query(alias="from")],
    ends_at: Annotated[UtcInstant, Query(alias="to")],
    current: CurrentSessionDep,
    session: SessionDep,
    professional_id: UUID | None = None,
) -> list[StaffAppointmentData]:
    agenda = await staff_appointments.list_agenda(
        session,
        viewer=current.user,
        starts_at=starts_at,
        ends_at=ends_at,
        professional_id=professional_id,
    )
    return [StaffAppointmentData.model_validate(item) for item in agenda]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_appointment(
    body: CreateAppointmentRequest,
    current: CurrentSessionDep,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
) -> CreatedAppointmentResponse:
    created = await staff_appointments.create_manual(
        session,
        settings,
        viewer=current.user,
        business=current.business,
        professional_id=body.professional_id,
        service_id=body.service_id,
        starts_at=body.starts_at,
        customer=StaffCustomer(
            name=body.customer.name,
            email=body.customer.email,
            phone=body.customer.phone,
        ),
        now=now,
    )
    return CreatedAppointmentResponse.model_validate(
        {
            **StaffAppointmentData.model_validate(created.appointment).model_dump(),
            "access_url": created.access_url,
            "email_status": created.email_status,
        }
    )


@router.post("/{appointment_id}/reschedule")
async def reschedule_appointment(
    appointment_id: UUID,
    body: StaffRescheduleRequest,
    current: CurrentSessionDep,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
) -> StaffChangeResponse:
    change = await staff_appointments.reschedule(
        session,
        settings,
        viewer=current.user,
        business=current.business,
        appointment_id=appointment_id,
        starts_at=body.starts_at,
        professional_id=body.professional_id,
        now=now,
    )
    return _change_response(change)


@router.post("/{appointment_id}/cancel")
async def cancel_appointment(
    appointment_id: UUID,
    current: CurrentSessionDep,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
) -> StaffChangeResponse:
    change = await staff_appointments.cancel(
        session,
        settings,
        viewer=current.user,
        business=current.business,
        appointment_id=appointment_id,
        now=now,
    )
    return _change_response(change)


@router.post("/{appointment_id}/complete")
async def complete_appointment(
    appointment_id: UUID, current: CurrentSessionDep, session: SessionDep, now: NowDep
) -> StaffAppointmentData:
    appointment = await staff_appointments.complete(
        session, viewer=current.user, appointment_id=appointment_id, now=now
    )
    return StaffAppointmentData.model_validate(appointment)


@router.post("/{appointment_id}/no-show")
async def mark_no_show(
    appointment_id: UUID, current: CurrentSessionDep, session: SessionDep, now: NowDep
) -> StaffAppointmentData:
    appointment = await staff_appointments.mark_no_show(
        session, viewer=current.user, appointment_id=appointment_id, now=now
    )
    return StaffAppointmentData.model_validate(appointment)
