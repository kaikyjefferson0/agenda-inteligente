from uuid import UUID

from pydantic import field_validator

from app.schemas.common import RequestModel, ResponseModel


class SetProfessionalServicesRequest(RequestModel):
    service_ids: list[UUID]

    @field_validator("service_ids")
    @classmethod
    def _remove_duplicates(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class ProfessionalData(ResponseModel):
    id: UUID
    user_id: UUID
    name: str
    email: str
    is_bookable: bool
    is_active: bool
    invitation_pending: bool
    service_ids: list[UUID]
