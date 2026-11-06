from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Appointment,
    AppointmentOrigin,
    AppointmentStatus,
    Business,
    Professional,
)
from tests.auth.helpers import API, accept, bearer, invite, last_link_token, login

BUSINESS_TIME_ZONE = ZoneInfo("America/Sao_Paulo")
MONDAY = 0
TUESDAY = 1


@dataclass
class Member:
    """A professional who accepted the invite and is logged in."""

    email: str
    token: str
    professional_id: str
    login_response: Response


async def add_member(
    client: AsyncClient, db: AsyncSession, owner_token: str, email: str
) -> Member:
    invitation = await invite(client, owner_token, email)
    assert invitation.status_code == 202, invitation.text
    link_token = await last_link_token(db, email)
    assert (await accept(client, link_token)).status_code == 204
    response = await login(client, email)
    assert response.status_code == 200, response.text
    return Member(
        email=email,
        token=response.json()["access_token"],
        professional_id=invitation.json()["professional_id"],
        login_response=response,
    )


async def create_service(
    client: AsyncClient, token: str, **overrides: Any
) -> dict[str, Any]:
    body = {"name": "Corte", "duration_minutes": 30, "price_cents": 5000, **overrides}
    response = await client.post(f"{API}/services", json=body, headers=bearer(token))
    assert response.status_code == 201, response.text
    return response.json()


async def start_serving(client: AsyncClient, token: str) -> dict[str, Any]:
    response = await client.post(f"{API}/professionals/me", headers=bearer(token))
    assert response.status_code in (200, 201), response.text
    return response.json()


async def put_hours(
    client: AsyncClient, token: str, professional_id: str, *intervals: dict[str, Any]
) -> Response:
    return await client.put(
        f"{API}/professionals/{professional_id}/working-hours",
        json={"intervals": list(intervals)},
        headers=bearer(token),
    )


def interval(weekday: int, start: str, end: str) -> dict[str, Any]:
    return {"weekday": weekday, "start_time": start, "end_time": end}


async def make_appointment(
    db: AsyncSession,
    professional_id: str,
    service_id: str,
    starts_at: datetime,
    *,
    minutes: int = 30,
    preparation: int = 0,
    status: AppointmentStatus = AppointmentStatus.CONFIRMED,
    customer_email: str | None = None,
) -> Appointment:
    """Booking routes come in a later phase, so the rows go straight to the database."""
    professional = await db.get(Professional, UUID(professional_id))
    assert professional is not None
    ends_at = starts_at + timedelta(minutes=minutes)
    appointment = Appointment(
        business_id=professional.business_id,
        professional_id=professional.id,
        service_id=UUID(service_id),
        starts_at=starts_at,
        ends_at=ends_at,
        blocked_until=ends_at + timedelta(minutes=preparation),
        duration_minutes=minutes,
        preparation_minutes=preparation,
        price_cents=5000,
        customer_name="Cliente de Teste",
        customer_email=customer_email,
        access_token_hash="hash-de-teste" if customer_email else None,
        status=status,
        origin=AppointmentOrigin.STAFF,
    )
    db.add(appointment)
    await db.commit()
    return appointment


def next_local(
    now: datetime, weekday: int, at: str, *, timezone: ZoneInfo = BUSINESS_TIME_ZONE
) -> datetime:
    """The given weekday and local time, at least a week from `now`, in UTC."""
    day = (now + timedelta(days=7)).astimezone(timezone).date()
    day += timedelta(days=(weekday - day.weekday()) % 7)
    hour, minute = map(int, at.split(":"))
    return datetime(
        day.year, day.month, day.day, hour, minute, tzinfo=timezone
    ).astimezone(UTC)


async def make_demo(db: AsyncSession, slug: str = "barbearia-um") -> None:
    await db.execute(update(Business).where(Business.slug == slug).values(is_demo=True))
    await db.commit()


async def get_business(db: AsyncSession, slug: str = "barbearia-um") -> Business:
    business = await db.scalar(
        select(Business)
        .where(Business.slug == slug)
        .execution_options(populate_existing=True)
    )
    assert business is not None
    return business


def iso_utc(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
