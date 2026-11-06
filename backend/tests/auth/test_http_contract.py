import logging

from httpx import ASGITransport, AsyncClient
from pytest import LogCaptureFixture, mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_now
from app.core.config import Settings, get_settings
from app.main import app
from tests.auth.helpers import (
    API,
    CSRF_HEADER,
    OTHER_PASSWORD,
    OWNER_EMAIL,
    PASSWORD,
    accept,
    invite,
    last_link_token,
    login,
    post_logout,
    post_refresh,
    raw_refresh_token,
    register_body,
    register_owner,
)

pytestmark = mark.anyio


async def test_ct45_validation_errors_follow_the_rfc_and_do_not_echo_passwords(
    client: AsyncClient,
) -> None:
    secret = "curta"

    response = await client.post(
        f"{API}/auth/register", json=register_body(password=secret)
    )

    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["status"] == 422
    assert body["errors"][0]["loc"] == ["body", "owner", "password"]
    assert set(body["errors"][0]) == {"loc", "msg", "type"}
    assert secret not in response.text


async def test_login_with_a_long_password_does_not_echo_it(
    client: AsyncClient,
) -> None:
    secret = "x" * 129

    response = await client.post(
        f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": secret}
    )

    assert response.status_code == 422
    assert secret not in response.text


async def test_unknown_route_is_a_problem_document(client: AsyncClient) -> None:
    response = await client.get(f"{API}/nao-existe")

    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "NOT_FOUND"


async def test_wrong_method_is_a_problem_document(client: AsyncClient) -> None:
    response = await client.get(f"{API}/auth/login")

    assert response.status_code == 405
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "HTTP_ERROR"
    assert "POST" in response.headers["allow"]


async def test_unexpected_error_reveals_nothing(
    client: AsyncClient, settings: Settings
) -> None:
    def explode() -> None:
        raise RuntimeError("detalhe interno sensível")

    app.dependency_overrides[get_now] = explode
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://test") as raw:
        response = await raw.post(
            f"{API}/auth/login",
            json={"email": OWNER_EMAIL, "password": PASSWORD},
        )

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "INTERNAL_ERROR"
    assert "sensível" not in response.text


async def test_cors_allows_the_configured_origin_with_credentials(
    client: AsyncClient,
) -> None:
    origin = get_settings().cors_origins[0]

    response = await client.options(
        f"{API}/auth/refresh",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Requested-With",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


async def test_cors_refuses_other_origins(client: AsyncClient) -> None:
    response = await client.options(
        f"{API}/auth/refresh",
        headers={
            "Origin": "https://atacante.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Requested-With",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


async def test_logs_never_contain_passwords_or_tokens(
    client: AsyncClient, db: AsyncSession, caplog: LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)

    owner = await register_owner(client)
    raw_token = raw_refresh_token(owner)
    access_token = owner.json()["access_token"]
    await invite(client, access_token)
    invite_token = await last_link_token(db, "pro@example.com")
    await accept(client, invite_token, OTHER_PASSWORD)
    await client.post(f"{API}/auth/password/forgot", json={"email": OWNER_EMAIL})
    reset_token = await last_link_token(db, OWNER_EMAIL)
    await login(client, OWNER_EMAIL, "senha-errada-999")
    rotated = await post_refresh(client, raw_token)
    await post_logout(client, raw_refresh_token(rotated))
    client.cookies.clear()
    await client.post(f"{API}/auth/refresh", headers=CSRF_HEADER)

    secrets = [
        PASSWORD,
        OTHER_PASSWORD,
        "senha-errada-999",
        raw_token,
        access_token,
        invite_token,
        reset_token,
    ]
    assert all(secret not in caplog.text for secret in secrets)
