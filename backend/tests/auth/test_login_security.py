from datetime import timedelta

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import RateLimitCounter
from tests.auth.conftest import CountingPasswordHasher
from tests.auth.helpers import (
    API,
    OWNER_EMAIL,
    PASSWORD,
    Clock,
    deactivate,
    invite,
    login,
    register_owner,
)

pytestmark = mark.anyio

PENDING_EMAIL = "pendente@example.com"
INACTIVE_EMAIL = "inativa@example.com"
UNKNOWN_EMAIL = "ninguem@example.com"


def visible_parts(response: Response) -> tuple[int, bytes, list[tuple[str, str]]]:
    headers = sorted(response.headers.items())
    return response.status_code, response.content, headers


async def test_ct37_login_failures_are_indistinguishable(
    client: AsyncClient,
    db: AsyncSession,
    hasher: type[CountingPasswordHasher],
) -> None:
    owner = await register_owner(client)
    token = owner.json()["access_token"]
    assert (await invite(client, token, PENDING_EMAIL)).status_code == 202
    second = await client.post(
        f"{API}/auth/register",
        json={
            "business": {
                "name": "Outro",
                "slug": "outro-negocio",
                "timezone": "America/Sao_Paulo",
            },
            "owner": {"name": "Ana", "email": INACTIVE_EMAIL, "password": PASSWORD},
        },
    )
    assert second.status_code == 201
    await deactivate(db, INACTIVE_EMAIL)
    client.cookies.clear()
    hasher.verify_calls = 0

    responses = [
        await login(client, UNKNOWN_EMAIL, PASSWORD),
        await login(client, OWNER_EMAIL, "senha-errada-999"),
        await login(client, PENDING_EMAIL, PASSWORD),
        # Correct password: only the deactivated state makes it fail.
        await login(client, INACTIVE_EMAIL, PASSWORD),
    ]

    assert hasher.verify_calls == len(responses)
    first = visible_parts(responses[0])
    assert all(visible_parts(response) == first for response in responses)
    assert responses[0].status_code == 401
    body = responses[0].json()
    assert body["code"] == "INVALID_CREDENTIALS"
    assert body["detail"] == "E-mail ou senha incorretos."
    assert "set-cookie" not in responses[0].headers


async def test_login_succeeds_ignoring_the_case_of_the_email(
    client: AsyncClient,
) -> None:
    await register_owner(client)

    response = await login(client, OWNER_EMAIL.upper())

    assert response.status_code == 200
    assert response.json()["access_token"]


async def test_ct41_login_limit_survives_the_rollback_of_failed_attempts(
    client: AsyncClient,
) -> None:
    await register_owner(client)
    for _ in range(10):
        assert (await login(client, password="senha-errada-999")).status_code == 401

    limited = await login(client)  # Even the right password is refused now.

    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"
    assert 0 < int(limited.headers["retry-after"]) <= 900


async def test_login_limit_is_the_same_for_unknown_emails(
    client: AsyncClient,
) -> None:
    for _ in range(10):
        assert (await login(client, UNKNOWN_EMAIL)).status_code == 401

    assert (await login(client, UNKNOWN_EMAIL)).status_code == 429


async def test_login_limit_ignores_the_case_of_the_email(
    client: AsyncClient,
) -> None:
    for _ in range(5):
        await login(client, UNKNOWN_EMAIL)
        await login(client, UNKNOWN_EMAIL.upper())

    assert (await login(client, UNKNOWN_EMAIL)).status_code == 429


async def test_login_limit_applies_per_email(client: AsyncClient) -> None:
    await register_owner(client)
    for _ in range(11):
        await login(client, UNKNOWN_EMAIL)

    assert (await login(client)).status_code == 200


async def test_login_limit_resets_in_the_next_window(
    client: AsyncClient, clock: Clock
) -> None:
    await register_owner(client)
    for _ in range(11):
        await login(client, password="senha-errada-999")

    clock.advance(timedelta(minutes=15))

    assert (await login(client)).status_code == 200


async def test_login_limit_per_ip_stops_attempts_across_many_emails(
    client: AsyncClient,
) -> None:
    for index in range(50):
        assert (await login(client, f"p{index}@example.com")).status_code == 401

    assert (await login(client, "mais-um@example.com")).status_code == 429


async def test_rate_limit_counters_keep_no_personal_data(
    client: AsyncClient, db: AsyncSession
) -> None:
    await login(client, UNKNOWN_EMAIL)

    keys = list(await db.scalars(select(RateLimitCounter.key)))

    assert len(keys) == 2
    for key in keys:
        assert len(key) == 64
        assert "ninguem" not in key
        assert "127.0.0.1" not in key


async def test_spoofed_ip_header_does_not_escape_the_limit_without_a_proxy(
    client: AsyncClient,
) -> None:
    for index in range(10):
        await client.post(
            f"{API}/auth/login",
            json={"email": UNKNOWN_EMAIL, "password": PASSWORD},
            headers={"X-Forwarded-For": f"10.0.0.{index}"},
        )

    assert (await login(client, UNKNOWN_EMAIL)).status_code == 429


async def test_trusted_proxy_header_identifies_the_client(
    client: AsyncClient, settings: Settings
) -> None:
    settings.trusted_client_ip_header = "X-Forwarded-For"

    async def attempt(forwarded_for: str) -> Response:
        return await client.post(
            f"{API}/auth/login",
            json={"email": UNKNOWN_EMAIL, "password": PASSWORD},
            headers={"X-Forwarded-For": forwarded_for},
        )

    # The client controls the left of the list; the proxy appends on the right.
    for index in range(10):
        await attempt(f"1.1.1.{index}, 203.0.113.7")

    assert (await attempt("2.2.2.2, 203.0.113.7")).status_code == 429
    assert (await attempt("203.0.113.7, 203.0.113.8")).status_code == 401
