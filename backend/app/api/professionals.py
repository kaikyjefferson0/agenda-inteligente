from fastapi import APIRouter, status

from app.api.deps import NowDep, OwnerSessionDep, SessionDep, SettingsDep
from app.schemas.auth import InvitationResponse, InviteProfessionalRequest
from app.services import invitations

router = APIRouter(prefix="/professionals", tags=["professionals"])


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
