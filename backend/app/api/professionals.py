from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Response, status
from pydantic import Field

from app.api.deps import (
    CurrentSessionDep,
    NowDep,
    OwnerSessionDep,
    SessionDep,
    SettingsDep,
)
from app.schemas.auth import InvitationResponse, InviteProfessionalRequest
from app.schemas.problems import AppointmentConflictsProblem, TimeBlockOverlapProblem
from app.schemas.professionals import (
    ProfessionalData,
    SetProfessionalServicesRequest,
)
from app.schemas.schedule import (
    AppointmentData,
    CreateTimeBlockRequest,
    IntervalData,
    ReplaceWorkingHoursRequest,
    ReplaceWorkingHoursResponse,
    TimeBlockData,
    WorkingHoursResponse,
)
from app.services import invitations, schedule, team

router = APIRouter(prefix="/professionals", tags=["professionals"])

# D94: the 409 of a block is told apart by `code`.
TimeBlockConflict = Annotated[
    AppointmentConflictsProblem | TimeBlockOverlapProblem,
    Field(discriminator="code"),
]


def _conflict(model: Any, description: str) -> dict[int | str, dict[str, Any]]:
    """D94: listed as `application/json`; it goes out as `problem+json`."""
    return {status.HTTP_409_CONFLICT: {"model": model, "description": description}}


@router.get("")
async def list_professionals(
    current: CurrentSessionDep, session: SessionDep
) -> list[ProfessionalData]:
    profiles = await team.list_professionals(session, current.user)
    return [ProfessionalData.model_validate(profile) for profile in profiles]


@router.post("/invitations", status_code=status.HTTP_202_ACCEPTED)
async def invite_professional(
    body: InviteProfessionalRequest,
    current: OwnerSessionDep,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
) -> InvitationResponse:
    invitation = await invitations.invite_professional(
        session,
        settings,
        business=current.business,
        name=body.name,
        email=body.email,
        now=now,
    )
    return InvitationResponse(
        professional_id=invitation.professional_id,
        email=invitation.email,
        expires_at=invitation.expires_at,
    )


@router.post(
    "/me",
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_200_OK: {
            "model": ProfessionalData,
            "description": "O registro já existia e voltou a atender",
        }
    },
)
async def start_serving(
    response: Response, current: OwnerSessionDep, session: SessionDep
) -> ProfessionalData:
    profile, created = await team.start_serving(session, owner=current.user)
    if not created:
        response.status_code = status.HTTP_200_OK
    return ProfessionalData.model_validate(profile)


@router.delete("/{professional_id}/invitation", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invitation(
    professional_id: UUID, current: OwnerSessionDep, session: SessionDep
) -> None:
    """D96: only a pending invite; the e-mail is free for a new one."""
    await invitations.cancel_invitation(
        session, business=current.business, professional_id=professional_id
    )


@router.post(
    "/{professional_id}/deactivate",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_conflict(
        AppointmentConflictsProblem,
        "APPOINTMENT_CONFLICTS: há agendamentos futuros confirmados (RN23)",
    ),
)
async def deactivate_professional(
    professional_id: UUID,
    current: OwnerSessionDep,
    session: SessionDep,
    now: NowDep,
) -> None:
    await team.deactivate_professional(
        session,
        business_id=current.business.id,
        professional_id=professional_id,
        now=now,
    )


@router.put("/{professional_id}/services")
async def set_professional_services(
    professional_id: UUID,
    body: SetProfessionalServicesRequest,
    current: OwnerSessionDep,
    session: SessionDep,
) -> ProfessionalData:
    profile = await team.set_professional_services(
        session,
        business_id=current.business.id,
        professional_id=professional_id,
        service_ids=body.service_ids,
    )
    return ProfessionalData.model_validate(profile)


@router.get("/{professional_id}/working-hours")
async def get_working_hours(
    professional_id: UUID, current: CurrentSessionDep, session: SessionDep
) -> WorkingHoursResponse:
    intervals = await schedule.get_working_hours(
        session, viewer=current.user, professional_id=professional_id
    )
    return WorkingHoursResponse(
        intervals=[IntervalData.model_validate(item) for item in intervals]
    )


@router.put("/{professional_id}/working-hours")
async def replace_working_hours(
    professional_id: UUID,
    body: ReplaceWorkingHoursRequest,
    current: CurrentSessionDep,
    session: SessionDep,
    now: NowDep,
) -> ReplaceWorkingHoursResponse:
    update = await schedule.replace_working_hours(
        session,
        viewer=current.user,
        timezone=current.business.timezone,
        professional_id=professional_id,
        intervals=body.intervals,
        now=now,
    )
    return ReplaceWorkingHoursResponse(
        intervals=[IntervalData.model_validate(item) for item in update.intervals],
        appointments_outside_hours=[
            AppointmentData.model_validate(appointment)
            for appointment in update.appointments_outside_hours
        ],
    )


@router.get("/{professional_id}/time-blocks")
async def list_time_blocks(
    professional_id: UUID, current: CurrentSessionDep, session: SessionDep
) -> list[TimeBlockData]:
    blocks = await schedule.list_time_blocks(
        session, viewer=current.user, professional_id=professional_id
    )
    return [TimeBlockData.model_validate(block) for block in blocks]


@router.post(
    "/{professional_id}/time-blocks",
    status_code=status.HTTP_201_CREATED,
    responses=_conflict(
        TimeBlockConflict,
        "APPOINTMENT_CONFLICTS, com a lista (RN21), que tem prioridade, ou "
        "TIME_BLOCK_OVERLAP",
    ),
)
async def create_time_block(
    professional_id: UUID,
    body: CreateTimeBlockRequest,
    current: CurrentSessionDep,
    session: SessionDep,
) -> TimeBlockData:
    block = await schedule.create_time_block(
        session,
        viewer=current.user,
        professional_id=professional_id,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        reason=body.reason,
    )
    return TimeBlockData.model_validate(block)
