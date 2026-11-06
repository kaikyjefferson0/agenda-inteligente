from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.core.security import decode_access_token
from app.domain.errors import AppError, ErrorCode
from app.models import Business, User, UserRole
from app.repositories import refresh_tokens, users

bearer_scheme = HTTPBearer(auto_error=False)
UNKNOWN_CLIENT_IP = "unknown"


def get_now() -> datetime:
    return datetime.now(UTC)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
NowDep = Annotated[datetime, Depends(get_now)]


def get_client_ip(request: Request, settings: SettingsDep) -> str:
    """Reads the IP only from the header of the trusted proxy, when configured.

    In a comma-separated list, the rightmost value is the one the closest proxy
    added. Everything to its left may have been sent by the client.
    """
    if settings.trusted_client_ip_header:
        value = request.headers.get(settings.trusted_client_ip_header, "")
        address = value.rsplit(",", maxsplit=1)[-1].strip()
        if address:
            return address
    return request.client.host if request.client else UNKNOWN_CLIENT_IP


ClientIpDep = Annotated[str, Depends(get_client_ip)]


def require_csrf_header(
    x_requested_with: Annotated[str | None, Header()] = None,
) -> None:
    """A custom header forces a CORS preflight, which only listed origins pass."""
    if not x_requested_with or not x_requested_with.strip():
        raise AppError(ErrorCode.FORBIDDEN)


@dataclass(frozen=True)
class CurrentSession:
    user: User
    business: Business


async def get_current_session(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: SessionDep,
    settings: SettingsDep,
) -> CurrentSession:
    """Resolves the user and the business from the session, on every request.

    Checking the account and the token family here makes deactivation, logout,
    password resets and detected reuse take effect immediately.
    """
    if credentials is None:
        raise AppError(ErrorCode.NOT_AUTHENTICATED)
    try:
        user_id, family_id = decode_access_token(
            credentials.credentials, settings.jwt_secret
        )
    except ValueError as exc:
        raise AppError(ErrorCode.NOT_AUTHENTICATED) from exc

    found = await users.get_with_business_for_auth(session, user_id)
    if found is None or not found[0].is_active:
        raise AppError(ErrorCode.NOT_AUTHENTICATED)
    if not await refresh_tokens.is_family_active(session, family_id, user_id):
        raise AppError(ErrorCode.NOT_AUTHENTICATED)
    return CurrentSession(user=found[0], business=found[1])


CurrentSessionDep = Annotated[CurrentSession, Depends(get_current_session)]


def require_owner(current: CurrentSessionDep) -> CurrentSession:
    if current.user.role is not UserRole.OWNER:
        raise AppError(ErrorCode.FORBIDDEN)
    return current


OwnerSessionDep = Annotated[CurrentSession, Depends(require_owner)]
