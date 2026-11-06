from fastapi import APIRouter

from app.api.deps import NowDep, OwnerSessionDep, SessionDep
from app.schemas.business import (
    BusinessData,
    UpdateBusinessRequest,
    UpdateBusinessResponse,
)
from app.schemas.schedule import AppointmentData
from app.services import business as business_service

router = APIRouter(prefix="/business", tags=["business"])


@router.get("")
async def get_business(current: OwnerSessionDep) -> BusinessData:
    return BusinessData.model_validate(current.business)


@router.patch("")
async def update_business(
    body: UpdateBusinessRequest,
    current: OwnerSessionDep,
    session: SessionDep,
    now: NowDep,
) -> UpdateBusinessResponse:
    update = await business_service.update_business(
        session,
        business_id=current.business.id,
        changes=body.model_dump(exclude_unset=True),
        now=now,
    )
    return UpdateBusinessResponse(
        **BusinessData.model_validate(update.business).model_dump(),
        appointments_outside_hours=[
            AppointmentData.model_validate(appointment)
            for appointment in update.appointments_outside_hours
        ],
    )
