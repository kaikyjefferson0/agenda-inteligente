from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

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
    invitation_pending: bool = Field(
        description=(
            "O convite ainda pode ser aceito: conta de profissional ativa e sem "
            "senha. Uma conta desativada nunca está pendente (D96)"
        )
    )
    invitation_expires_at: datetime | None = Field(
        description=(
            "Quando vence o link do convite pendente, em UTC (RN24, 7 dias). No "
            "passado, o convite venceu e pode ser renovado. Nulo sem convite "
            "pendente (D95)"
        )
    )
    service_ids: list[UUID]
