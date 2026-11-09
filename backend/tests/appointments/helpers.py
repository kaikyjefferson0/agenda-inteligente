from datetime import datetime
from typing import Any

from httpx import AsyncClient, Response

from tests.auth.helpers import API, bearer
from tests.configuration.helpers import iso_utc
from tests.public.helpers import CUSTOMER_NAME, CUSTOMER_PHONE

AGENDA = f"{API}/appointments"
CONFIRMATION = "appointment_confirmation"
CANCELLATION = "appointment_cancellation"
RESCHEDULE = "appointment_reschedule"
# D26: exactly these fields, never the token hash nor the idempotency fields.
AGENDA_FIELDS = {
    "id",
    "professional_id",
    "service_id",
    "service_name",
    "starts_at",
    "ends_at",
    "blocked_until",
    "duration_minutes",
    "preparation_minutes",
    "price_cents",
    "status",
    "origin",
    "customer_name",
    "customer_email",
    "customer_phone",
    "cancelled_at",
}


def manual_body(
    professional_id: str,
    service_id: str,
    starts_at: datetime | str,
    *,
    name: str = CUSTOMER_NAME,
    email: str | None = None,
    phone: str | None = CUSTOMER_PHONE,
) -> dict[str, Any]:
    customer: dict[str, Any] = {"name": name, "phone": phone}
    if email is not None:
        customer["email"] = email
    return {
        "professional_id": professional_id,
        "service_id": service_id,
        "starts_at": starts_at if isinstance(starts_at, str) else iso_utc(starts_at),
        "customer": customer,
    }


async def post_manual(
    client: AsyncClient, token: str, body: dict[str, Any]
) -> Response:
    return await client.post(AGENDA, json=body, headers=bearer(token))


async def create_manual(
    client: AsyncClient,
    token: str,
    professional_id: str,
    service_id: str,
    starts_at: datetime,
    **customer: Any,
) -> dict[str, Any]:
    response = await post_manual(
        client, token, manual_body(professional_id, service_id, starts_at, **customer)
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def get_agenda(
    client: AsyncClient,
    token: str,
    starts_at: datetime | str,
    ends_at: datetime | str,
    *,
    professional_id: str | None = None,
) -> Response:
    params = {
        "from": starts_at if isinstance(starts_at, str) else iso_utc(starts_at),
        "to": ends_at if isinstance(ends_at, str) else iso_utc(ends_at),
    }
    if professional_id is not None:
        params["professional_id"] = professional_id
    return await client.get(AGENDA, params=params, headers=bearer(token))


async def act(
    client: AsyncClient, token: str, appointment_id: str, action: str
) -> Response:
    """`cancel`, `complete` or `no-show`, none of them with a body."""
    return await client.post(
        f"{AGENDA}/{appointment_id}/{action}", headers=bearer(token)
    )


async def staff_reschedule(
    client: AsyncClient,
    token: str,
    appointment_id: str,
    starts_at: datetime | str,
    *,
    professional_id: str | None = None,
) -> Response:
    body: dict[str, Any] = {
        "starts_at": starts_at if isinstance(starts_at, str) else iso_utc(starts_at)
    }
    if professional_id is not None:
        body["professional_id"] = professional_id
    return await client.post(
        f"{AGENDA}/{appointment_id}/reschedule", json=body, headers=bearer(token)
    )
