from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentSessionDep, SessionDep
from app.services import schedule

router = APIRouter(prefix="/time-blocks", tags=["time-blocks"])


@router.delete("/{time_block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_time_block(
    time_block_id: UUID, current: CurrentSessionDep, session: SessionDep
) -> None:
    await schedule.delete_time_block(
        session, viewer=current.user, time_block_id=time_block_id
    )
