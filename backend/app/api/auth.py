from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response, status
from fastapi.responses import JSONResponse

from app.api.deps import (
    ClientIpDep,
    CurrentSessionDep,
    NowDep,
    SessionDep,
    SettingsDep,
    require_allowed_origin,
    require_csrf_header,
)
from app.api.errors import app_error_response
from app.core.security import ACCESS_TOKEN_TTL
from app.domain.errors import AppError, ErrorCode
from app.schemas.auth import (
    AcceptInvitationRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
)
from app.services import auth, invitations, passwords
from app.services.auth import IssuedSession

router = APIRouter(prefix="/auth", tags=["auth"])

# D108: the __Host- prefix makes the browser refuse a cookie planted by a
# sibling subdomain; it requires Secure, no Domain and Path=/.
REFRESH_COOKIE_NAME = "__Host-refresh_token"
REFRESH_COOKIE_PATH = "/"

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)]


def require_registration_enabled(settings: SettingsDep) -> None:
    """A dependency, so a disabled route answers 403 even to an invalid body."""
    if not settings.registration_enabled:
        raise AppError(ErrorCode.REGISTRATION_DISABLED)


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )


def _start_session(
    response: Response, issued: IssuedSession, now: datetime
) -> SessionResponse:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        issued.refresh_token,
        max_age=int((issued.refresh_expires_at - now).total_seconds()),
        path=REFRESH_COOKIE_PATH,
        secure=True,
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    return SessionResponse(
        access_token=issued.access_token,
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
    )


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_registration_enabled)],
)
async def register(
    body: RegisterRequest,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    client_ip: ClientIpDep,
    now: NowDep,
) -> SessionResponse:
    issued = await auth.register(
        session,
        settings,
        business_name=body.business.name,
        slug=body.business.slug,
        timezone=body.business.timezone,
        owner_name=body.owner.name,
        email=body.owner.email,
        password=body.owner.password,
        client_ip=client_ip,
        now=now,
    )
    return _start_session(response, issued, now)


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    client_ip: ClientIpDep,
    now: NowDep,
) -> SessionResponse:
    issued = await auth.login(
        session,
        settings,
        email=body.email,
        password=body.password,
        client_ip=client_ip,
        now=now,
    )
    return _start_session(response, issued, now)


@router.post(
    "/refresh",
    dependencies=[Depends(require_allowed_origin), Depends(require_csrf_header)],
    response_model=SessionResponse,
)
async def refresh(
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
    refresh_cookie: RefreshCookie = None,
) -> SessionResponse | JSONResponse:
    try:
        issued = await auth.refresh_session(
            session, settings, raw_token=refresh_cookie, now=now
        )
    except AppError as error:
        failure = app_error_response(error)
        _clear_refresh_cookie(failure)
        return failure
    return _start_session(response, issued, now)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_allowed_origin), Depends(require_csrf_header)],
)
async def logout(
    response: Response,
    session: SessionDep,
    now: NowDep,
    refresh_cookie: RefreshCookie = None,
) -> None:
    await auth.logout(session, raw_token=refresh_cookie, now=now)
    _clear_refresh_cookie(response)


@router.get("/me")
async def me(current: CurrentSessionDep) -> MeResponse:
    return MeResponse.model_validate(
        {"user": current.user, "business": current.business},
        from_attributes=True,
    )


@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    body: ForgotPasswordRequest,
    session: SessionDep,
    settings: SettingsDep,
    client_ip: ClientIpDep,
    now: NowDep,
) -> None:
    await passwords.forgot_password(
        session, settings, email=body.email, client_ip=client_ip, now=now
    )


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    body: ResetPasswordRequest,
    session: SessionDep,
    settings: SettingsDep,
    client_ip: ClientIpDep,
    now: NowDep,
) -> None:
    await passwords.reset_password(
        session,
        settings,
        raw_token=body.token,
        new_password=body.new_password,
        client_ip=client_ip,
        now=now,
    )


@router.post("/invitations/accept", status_code=status.HTTP_204_NO_CONTENT)
async def accept_invitation(
    body: AcceptInvitationRequest,
    session: SessionDep,
    settings: SettingsDep,
    client_ip: ClientIpDep,
    now: NowDep,
) -> None:
    await invitations.accept_invitation(
        session,
        settings,
        raw_token=body.token,
        password=body.password,
        client_ip=client_ip,
        now=now,
    )
