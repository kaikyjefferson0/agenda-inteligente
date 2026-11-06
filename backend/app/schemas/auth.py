from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, StringConstraints

from app.domain.auth import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH
from app.models import UserRole
from app.schemas.common import Name, RequestModel, Slug, TimeZoneName

MAX_TOKEN_LENGTH = 512

NewPassword = Annotated[
    str,
    StringConstraints(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH),
]
AccountTokenValue = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_TOKEN_LENGTH)
]


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
