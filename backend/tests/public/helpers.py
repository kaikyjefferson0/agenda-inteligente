from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, EmailOutbox
from tests.auth.helpers import API, bearer
from tests.configuration.helpers import BUSINESS_TIME_ZONE

SLUG = "barbearia-um"
OTHER_SLUG = "outro-negocio"
CUSTOMER_EMAIL = "cliente@example.com"
CUSTOMER_NAME = "Cliente de Exemplo"
CUSTOMER_PHONE = "+5511999999999"


def page_path(slug: str = SLUG) -> str:
    return f"{API}/public/businesses/{slug}"


def local_day(instant: datetime) -> str:
    return instant.astimezone(BUSINESS_TIME_ZONE).date().isoformat()


def local_iso(instant: datetime) -> str:
    return instant.astimezone(BUSINESS_TIME_ZONE).isoformat()


async def link_services(
    client: AsyncClient, token: str, professional_id: str, *service_ids: str
) -> None:
    response = await client.put(
        f"{API}/professionals/{professional_id}/services",
        json={"service_ids": list(service_ids)},
        headers=bearer(token),
    )
    assert response.status_code == 200, response.text


async def get_availability(
    client: AsyncClient,
    service_id: str,
    day: str,
    *,
    professional_id: str | None = None,
    slug: str = SLUG,
) -> Response:
    params = {"service_id": service_id, "date": day}
    if professional_id is not None:
        params["professional_id"] = professional_id
    return await client.get(f"{page_path(slug)}/availability", params=params)


def offered(response: Response) -> list[str]:
    assert response.status_code == 200, response.text
    return [slot["starts_at"] for slot in response.json()["slots"]]


def booking_body(
    service_id: str,
    starts_at: datetime | str,
    *,
    professional_id: str | None = None,
    email: str = CUSTOMER_EMAIL,
    name: str = CUSTOMER_NAME,
    phone: str = CUSTOMER_PHONE,
) -> dict[str, Any]:
    return {
        "service_id": service_id,
        "professional_id": professional_id,
        "starts_at": starts_at if isinstance(starts_at, str) else local_iso(starts_at),
        "customer": {"name": name, "email": email, "phone": phone},
    }


async def post_booking(
    client: AsyncClient,
    body: dict[str, Any],
    *,
    key: str | None = None,
    slug: str = SLUG,
) -> Response:
    return await client.post(
        f"{page_path(slug)}/appointments",
        json=body,
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def link_token(response: Response) -> str:
    return response.json()["access_url"].rsplit("/", maxsplit=1)[-1]


async def count_appointments(db: AsyncSession) -> int | None:
    return await db.scalar(select(func.count()).select_from(Appointment))


async def count_emails(db: AsyncSession) -> int | None:
    return await db.scalar(
        select(func.count())
        .select_from(EmailOutbox)
        .where(EmailOutbox.template == "appointment_confirmation")
    )


async def get_appointment(db: AsyncSession, appointment_id: str) -> Appointment:
    appointment = await db.scalar(
        select(Appointment)
        .where(Appointment.id == UUID(appointment_id))
        .execution_options(populate_existing=True)
    )
    assert appointment is not None
    return appointment
