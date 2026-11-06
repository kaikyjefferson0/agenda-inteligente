from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
)

from app.domain.auth import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH
from app.models import UserRole

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
MAX_TOKEN_LENGTH = 512


def _validate_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("timezone must be a valid IANA name")
    return value


Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
Slug = Annotated[
    str, StringConstraints(min_length=3, max_length=63, pattern=SLUG_PATTERN)
]
TimeZoneName = Annotated[str, AfterValidator(_validate_timezone)]
NewPassword = Annotated[
    str,
    StringConstraints(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH),
]
AccountTokenValue = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_TOKEN_LENGTH)
]


class RequestModel(BaseModel):
    """Refuses unknown fields, such as a business_id sent by the client."""

    model_config = ConfigDict(extra="forbid")


class BusinessRegistration(RequestModel):
    name: Name
    slug: Slug
    timezone: TimeZoneName


class OwnerRegistration(RequestModel):
    name: Name
    email: EmailStr
    password: NewPassword


class RegisterRequest(RequestModel):
    business: BusinessRegistration
    owner: OwnerRegistration


class LoginRequest(RequestModel):
    email: EmailStr
    password: Annotated[
        str, StringConstraints(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    ]


class ForgotPasswordRequest(RequestModel):
    email: EmailStr


class ResetPasswordRequest(RequestModel):
    token: AccountTokenValue
    new_password: NewPassword


class AcceptInvitationRequest(RequestModel):
    token: AccountTokenValue
    password: NewPassword


class InviteProfessionalRequest(RequestModel):
    name: Name
    email: EmailStr


class SessionResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(description="Validade do token de acesso, em segundos")


class CurrentUserData(BaseModel):
    id: UUID
    name: str
    email: str
    role: UserRole


class CurrentBusinessData(BaseModel):
    id: UUID
    name: str
    slug: str
    timezone: str
    is_demo: bool


class MeResponse(BaseModel):
    user: CurrentUserData
    business: CurrentBusinessData


class InvitationResponse(BaseModel):
    professional_id: UUID
    email: str
    expires_at: datetime
