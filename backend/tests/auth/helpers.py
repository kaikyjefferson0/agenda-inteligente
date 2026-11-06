from dataclasses import dataclass
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from typing import Any
from uuid import UUID

from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.models import EmailOutbox, RefreshToken, User

API = "/api/v1"
PASSWORD = "senha-correta-123"
OTHER_PASSWORD = "outra-senha-forte-456"
OWNER_EMAIL = "dono@example.com"
CSRF_HEADER = {"X-Requested-With": "XMLHttpRequest"}


@dataclass
class Clock:
    now: datetime

    def advance(self, delta: timedelta) -> None:
        self.now += delta


def register_body(
    slug: str = "barbearia-um", email: str = OWNER_EMAIL, **owner: Any
) -> dict[str, Any]:
    return {
        "business": {
            "name": "Barbearia",
            "slug": slug,
            "timezone": "America/Sao_Paulo",
        },
        "owner": {"name": "Dona", "email": email, "password": PASSWORD, **owner},
    }


def refresh_cookie(response: Response) -> SimpleCookie:
    cookie: SimpleCookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    return cookie


def raw_refresh_token(response: Response) -> str:
    return refresh_cookie(response)["refresh_token"].value


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def post_refresh(client: AsyncClient, raw_token: str) -> Response:
    """Sends exactly this cookie, as a client replaying an old token would."""
    client.cookies.clear()
    return await client.post(
        f"{API}/auth/refresh",
        headers={**CSRF_HEADER, "Cookie": f"refresh_token={raw_token}"},
    )


async def post_logout(client: AsyncClient, raw_token: str) -> Response:
    client.cookies.clear()
    return await client.post(
        f"{API}/auth/logout",
        headers={**CSRF_HEADER, "Cookie": f"refresh_token={raw_token}"},
    )


async def register_owner(
    client: AsyncClient, slug: str = "barbearia-um", email: str = OWNER_EMAIL
) -> Response:
    response = await client.post(
        f"{API}/auth/register", json=register_body(slug, email)
    )
    assert response.status_code == 201, response.text
    return response


async def login(
    client: AsyncClient, email: str = OWNER_EMAIL, password: str = PASSWORD
) -> Response:
    return await client.post(
        f"{API}/auth/login", json={"email": email, "password": password}
    )


async def invite(
    client: AsyncClient,
    access_token: str,
    email: str = "pro@example.com",
    name: str = "Profissional",
) -> Response:
    return await client.post(
        f"{API}/professionals/invitations",
        json={"name": name, "email": email},
        headers=bearer(access_token),
    )


async def accept(client: AsyncClient, token: str, password: str = PASSWORD) -> Response:
    return await client.post(
        f"{API}/auth/invitations/accept",
        json={"token": token, "password": password},
    )


async def outbox_for(db: AsyncSession, email: str) -> list[EmailOutbox]:
    rows = await db.scalars(
        select(EmailOutbox)
        .where(EmailOutbox.to_email == email)
        .order_by(EmailOutbox.created_at)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def last_link_token(db: AsyncSession, email: str) -> str:
    messages = await outbox_for(db, email)
    return messages[-1].payload["url"].rsplit("/", maxsplit=1)[-1]


async def get_user(db: AsyncSession, email: str) -> User:
    user = await db.scalar(
        select(User)
        .where(User.email == email)
        .execution_options(populate_existing=True)
    )
    assert user is not None
    return user


async def deactivate(db: AsyncSession, email: str) -> None:
    await db.execute(update(User).where(User.email == email).values(is_active=False))
    await db.commit()


async def family_of(db: AsyncSession, access_token: str) -> list[RefreshToken]:
    _, family_id = decode_access_token(access_token, get_settings().jwt_secret)
    return await tokens_of_family(db, family_id)


async def tokens_of_family(db: AsyncSession, family_id: UUID) -> list[RefreshToken]:
    rows = await db.scalars(
        select(RefreshToken)
        .where(RefreshToken.family_id == family_id)
        .execution_options(populate_existing=True)
    )
    return list(rows)
