from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentSessionDep, OwnerSessionDep, SessionDep
from app.schemas.catalog import (
    CreateServiceRequest,
    ServiceData,
    UpdateServiceRequest,
)
from app.services import catalog

router = APIRouter(prefix="/services", tags=["services"])


@router.get("")
async def list_services(
    current: CurrentSessionDep, session: SessionDep
) -> list[ServiceData]:
    services = await catalog.list_services(session, current.business.id)
    return [ServiceData.model_validate(service) for service in services]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_service(
    body: CreateServiceRequest, current: OwnerSessionDep, session: SessionDep
) -> ServiceData:
    service = await catalog.create_service(
        session,
        business=current.business,
        name=body.name,
        duration_minutes=body.duration_minutes,
        preparation_minutes=body.preparation_minutes,
        price_cents=body.price_cents,
    )
    return ServiceData.model_validate(service)


@router.patch("/{service_id}")
async def update_service(
    service_id: UUID,
    body: UpdateServiceRequest,
    current: OwnerSessionDep,
    session: SessionDep,
) -> ServiceData:
    service = await catalog.update_service(
        session,
        business=current.business,
        service_id=service_id,
        changes=body.model_dump(exclude_unset=True),
    )
    return ServiceData.model_validate(service)
