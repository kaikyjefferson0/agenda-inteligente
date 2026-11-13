"""D94: the error bodies of the OpenAPI that carry fields of their own.

FastAPI lists them as `application/json`, as it does with the 422; the body goes
out as `application/problem+json`, like every error (RFC 9457). The errors
without fields of their own follow the generic problem of docs/07-api.md and
are not declared route by route.
"""

from typing import Literal

from pydantic import Field

from app.domain.errors import ErrorCode
from app.schemas.common import ResponseModel
from app.schemas.schedule import AppointmentData


class Problem(ResponseModel):
    """The generic problem, with a stable `code`."""

    type: str
    title: str
    status: int
    code: ErrorCode
    detail: str


class AppointmentConflictsProblem(ResponseModel):
    """A block over appointments (RN21) or a deactivation with future ones (RN23)."""

    type: str
    title: str
    status: Literal[409]
    code: Literal["APPOINTMENT_CONFLICTS"]
    detail: str
    conflicts: list[AppointmentData] = Field(
        description="Os agendamentos a resolver antes, sem contato do cliente"
    )


class TimeBlockOverlapProblem(ResponseModel):
    """A block over another block; without a list."""

    type: str
    title: str
    status: Literal[409]
    code: Literal["TIME_BLOCK_OVERLAP"]
    detail: str


class FieldErrorData(ResponseModel):
    loc: list[str | int] = Field(
        description="Onde: `body`, `query`, `path` ou `header`, seguido do campo"
    )
    msg: str = Field(description="Em inglês; o frontend mostra o próprio texto")
    type: str


class ValidationProblem(ResponseModel):
    """Every 422, from the framework or from a rule that needs stored values."""

    type: str
    title: str
    status: Literal[422]
    code: Literal["VALIDATION_ERROR"]
    detail: str
    errors: list[FieldErrorData]


class HealthResponse(ResponseModel):
    status: Literal["ok"]
    database: Literal["ok"]
