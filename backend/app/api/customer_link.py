from fastapi import APIRouter
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.deps import NowDep, SessionDep, SettingsDep, limited_by_ip
from app.domain.rate_limits import PUBLIC_CUSTOMER_LINK_BY_IP
from app.schemas.public import (
    CustomerAppointmentResponse,
    CustomerChangeResponse,
    LinkBusinessData,
    LinkProfessionalData,
    LinkServiceData,
    RescheduleRequest,
)
from app.services import customer_link
from app.services.customer_link import CustomerAppointment, CustomerChange

# D22: one counter for the three routes, so it lives on the router.
router = APIRouter(
    prefix="/public/appointments",
    tags=["public"],
    dependencies=[limited_by_ip(PUBLIC_CUSTOMER_LINK_BY_IP)],
)

# D22: the token is in the URL, so neither caches nor other sites may keep it.
LINK_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}


class CustomerLinkHeadersMiddleware:
    """Adds LINK_HEADERS to every response under the prefix, errors included.

    A middleware, and not a dependency, because error responses are built by the
    exception handlers, which never see the headers of a dependency.
    """

    def __init__(self, app: ASGIApp, path_prefix: str) -> None:
        self.app = app
        self.path_prefix = path_prefix.rstrip("/")

    def _applies_to(self, path: str) -> bool:
        return path == self.path_prefix or path.startswith(f"{self.path_prefix}/")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self._applies_to(scope["path"]):
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in LINK_HEADERS.items():
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _appointment_data(appointment: CustomerAppointment) -> dict[str, object]:
    return {
        "id": appointment.id,
        "status": appointment.status,
        "starts_at": appointment.starts_at,
        "ends_at": appointment.ends_at,
        "business": LinkBusinessData(
            name=appointment.business.name,
            slug=appointment.business.slug,
            timezone=appointment.business.timezone,
        ),
        "service": LinkServiceData(
            id=appointment.service.id,
            name=appointment.service.name,
            duration_minutes=appointment.service.duration_minutes,
            price_cents=appointment.service.price_cents,
        ),
        "professional": LinkProfessionalData(
            id=appointment.professional.id, name=appointment.professional.name
        ),
        "can_cancel": appointment.can_cancel,
        "can_reschedule": appointment.can_reschedule,
        "change_deadline_at": appointment.change_deadline_at,
    }


def _change_response(change: CustomerChange) -> CustomerChangeResponse:
    return CustomerChangeResponse.model_validate(
        {**_appointment_data(change.appointment), "email_status": change.email_status}
    )


@router.get("/{token}")
async def get_appointment(
    token: str, session: SessionDep, now: NowDep
) -> CustomerAppointmentResponse:
    appointment = await customer_link.get_by_token(session, token=token, now=now)
    return CustomerAppointmentResponse.model_validate(_appointment_data(appointment))


@router.post("/{token}/cancel")
async def cancel_appointment(
    token: str, session: SessionDep, settings: SettingsDep, now: NowDep
) -> CustomerChangeResponse:
    change = await customer_link.cancel_by_token(
        session, settings, token=token, now=now
    )
    return _change_response(change)


@router.post("/{token}/reschedule")
async def reschedule_appointment(
    token: str,
    body: RescheduleRequest,
    session: SessionDep,
    settings: SettingsDep,
    now: NowDep,
) -> CustomerChangeResponse:
    change = await customer_link.reschedule_by_token(
        session,
        settings,
        token=token,
        starts_at=body.starts_at,
        professional_id=body.professional_id,
        now=now,
    )
    return _change_response(change)
