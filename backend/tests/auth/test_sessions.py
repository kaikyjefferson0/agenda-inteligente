import asyncio
from datetime import timedelta

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_opaque_token
from app.models import Business, Professional, RefreshToken, User
from tests.auth.helpers import (
    API,
    CSRF_HEADER,
    ORIGIN,
    OWNER_EMAIL,
    PASSWORD,
    REFRESH_COOKIE,
    Clock,
    bearer,
    deactivate,
    family_of,
    login,
    post_logout,
    post_refresh,
    raw_refresh_token,
    refresh_cookie,
    register_body,
    register_owner,
)

pytestmark = mark.anyio


# Registration (UC01, RN27)


async def test_register_creates_business_and_owner_and_starts_the_session(
    client: AsyncClient, db: AsyncSession
) -> None:
    response = await register_owner(client)

    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 900
    assert response.headers["cache-control"] == "no-store"
    me = await client.get(f"{API}/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["user"]["email"] == OWNER_EMAIL
    assert me.json()["user"]["role"] == "owner"
    business = await db.scalar(select(Business))
    assert business is not None
    assert (business.slot_step_minutes, business.min_advance_minutes) == (15, 60)
    assert (business.max_advance_days, business.change_deadline_minutes) == (30, 120)
    assert business.is_demo is False


async def test_owner_has_no_professional_record_until_choosing_to_attend(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)

    assert await db.scalar(select(func.count()).select_from(Professional)) == 0


async def test_ct26_register_disabled_creates_nothing(
    client: AsyncClient, db: AsyncSession, settings: Settings
) -> None:
    settings.registration_enabled = False

    response = await client.post(f"{API}/auth/register", json=register_body())
    invalid = await client.post(f"{API}/auth/register", json={})

    assert response.status_code == 403
    assert response.json()["code"] == "REGISTRATION_DISABLED"
    assert invalid.status_code == 403
    assert await db.scalar(select(func.count()).select_from(Business)) == 0


async def test_register_with_used_slug_is_refused(client: AsyncClient) -> None:
    await register_owner(client)

    response = await client.post(
        f"{API}/auth/register", json=register_body(email="outra@example.com")
    )

    assert response.status_code == 409
    assert response.json()["code"] == "SLUG_IN_USE"


async def test_register_with_used_email_leaves_no_orphan_business(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)

    response = await client.post(
        f"{API}/auth/register",
        json=register_body(slug="outro-negocio", email=OWNER_EMAIL.upper()),
    )

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_IN_USE"
    assert await db.scalar(select(func.count()).select_from(Business)) == 1


async def test_concurrent_registrations_have_a_single_winner(
    client: AsyncClient, db: AsyncSession
) -> None:
    responses = await asyncio.gather(
        *(client.post(f"{API}/auth/register", json=register_body()) for _ in range(2))
    )

    assert sorted(r.status_code for r in responses) == [201, 409]
    assert await db.scalar(select(func.count()).select_from(User)) == 1


# Refresh cookie


async def test_refresh_cookie_has_the_required_flags(client: AsyncClient) -> None:
    response = await register_owner(client)

    morsel = refresh_cookie(response)[REFRESH_COOKIE]
    assert morsel["httponly"] is True
    assert morsel["secure"] is True
    assert morsel["samesite"].lower() == "strict"
    assert morsel["path"] == "/"
    assert morsel["domain"] == ""
    assert int(morsel["max-age"]) == int(timedelta(days=7).total_seconds())


async def test_only_the_hash_of_the_refresh_token_is_stored(
    client: AsyncClient, db: AsyncSession
) -> None:
    response = await register_owner(client)

    raw_token = raw_refresh_token(response)
    token = await db.scalar(select(RefreshToken))
    assert token is not None
    assert token.token_hash == hash_opaque_token(raw_token)
    assert raw_token not in token.token_hash


# Rotation and reuse (UC02, CT28)


async def test_refresh_rotates_the_token_inside_the_same_family(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)

    second = await post_refresh(client, raw_refresh_token(first))

    assert second.status_code == 200
    assert second.headers["cache-control"] == "no-store"
    assert raw_refresh_token(second) != raw_refresh_token(first)
    family = await family_of(db, second.json()["access_token"])
    assert len(family) == 2
    assert sum(token.used_at is not None for token in family) == 1
    assert all(token.revoked_at is None for token in family)


async def test_ct28_reused_refresh_revokes_the_whole_family(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)
    stolen = raw_refresh_token(first)
    second = await post_refresh(client, stolen)
    latest = raw_refresh_token(second)
    third = await post_refresh(client, latest)
    newest = raw_refresh_token(third)

    reuse = await post_refresh(client, stolen)

    assert reuse.status_code == 401
    assert reuse.json()["code"] == "INVALID_REFRESH_TOKEN"
    assert f'{REFRESH_COOKIE}=""' in reuse.headers["set-cookie"]
    family = await family_of(db, third.json()["access_token"])
    assert len(family) == 3
    assert all(token.revoked_at is not None for token in family)
    # The legitimate holder and the attacker both lose the session.
    assert (await post_refresh(client, newest)).status_code == 401
    me = await client.get(
        f"{API}/auth/me", headers=bearer(third.json()["access_token"])
    )
    assert me.status_code == 401


async def test_reuse_does_not_touch_other_sessions_of_the_user(
    client: AsyncClient,
) -> None:
    first = await register_owner(client)
    other_session = await login(client)
    await post_refresh(client, raw_refresh_token(first))

    await post_refresh(client, raw_refresh_token(first))

    assert (
        await post_refresh(client, raw_refresh_token(other_session))
    ).status_code == 200


async def test_ct38_concurrent_refreshes_have_one_winner_and_revoke_the_family(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)
    raw_token = raw_refresh_token(first)
    client.cookies.clear()
    headers = {**CSRF_HEADER, "Cookie": f"{REFRESH_COOKIE}={raw_token}"}

    responses = await asyncio.gather(
        client.post(f"{API}/auth/refresh", headers=headers),
        client.post(f"{API}/auth/refresh", headers=headers),
    )

    assert sorted(r.status_code for r in responses) == [200, 401]
    family = await family_of(db, first.json()["access_token"])
    assert len(family) == 2
    assert all(token.revoked_at is not None for token in family)


async def test_unknown_or_missing_refresh_token_is_refused(
    client: AsyncClient,
) -> None:
    unknown = await post_refresh(client, "desconhecido")
    client.cookies.clear()
    missing = await client.post(f"{API}/auth/refresh", headers=CSRF_HEADER)

    for response in (unknown, missing):
        assert response.status_code == 401
        assert response.json()["code"] == "INVALID_REFRESH_TOKEN"


async def test_refresh_of_a_deactivated_account_revokes_the_family(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)
    await deactivate(db, OWNER_EMAIL)

    response = await post_refresh(client, raw_refresh_token(first))

    assert response.status_code == 401
    family = await family_of(db, first.json()["access_token"])
    assert all(token.revoked_at is not None for token in family)


# Lifetime: 7 days without use, 30 days since the login (RN31)


async def test_ct43_refresh_expires_after_seven_days_without_use(
    client: AsyncClient, clock: Clock
) -> None:
    first = await register_owner(client)
    clock.advance(timedelta(days=7))

    response = await post_refresh(client, raw_refresh_token(first))

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_REFRESH_TOKEN"


async def test_refresh_just_before_seven_days_slides_the_validity(
    client: AsyncClient, clock: Clock
) -> None:
    first = await register_owner(client)
    clock.advance(timedelta(days=6, hours=23))

    response = await post_refresh(client, raw_refresh_token(first))

    assert response.status_code == 200
    max_age = int(refresh_cookie(response)[REFRESH_COOKIE]["max-age"])
    assert max_age == int(timedelta(days=7).total_seconds())


async def test_ct43_session_in_use_ends_thirty_days_after_the_login(
    client: AsyncClient, clock: Clock
) -> None:
    response = await register_owner(client)
    for _ in range(4):  # Days 6, 12, 18 and 24.
        clock.advance(timedelta(days=6))
        response = await post_refresh(client, raw_refresh_token(response))
        assert response.status_code == 200

    # Issued on day 24, so only 6 of the usual 7 days remain.
    max_age = int(refresh_cookie(response)[REFRESH_COOKIE]["max-age"])
    assert max_age == int(timedelta(days=6).total_seconds())

    clock.advance(timedelta(days=5, hours=23))
    response = await post_refresh(client, raw_refresh_token(response))
    assert response.status_code == 200
    assert int(refresh_cookie(response)[REFRESH_COOKIE]["max-age"]) == 3600

    clock.advance(timedelta(hours=1))  # Exactly day 30.
    assert (await post_refresh(client, raw_refresh_token(response))).status_code == 401


async def test_new_login_starts_a_new_thirty_day_limit(
    client: AsyncClient, clock: Clock
) -> None:
    await register_owner(client)
    clock.advance(timedelta(days=29))

    response = await login(client)

    max_age = int(refresh_cookie(response)[REFRESH_COOKIE]["max-age"])
    assert max_age == int(timedelta(days=7).total_seconds())


# Login


async def test_login_session_is_persisted_for_the_next_requests(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)

    response = await login(client)

    assert response.status_code == 200
    raw_token = raw_refresh_token(response)
    # Each request and this inspection use their own connection, so they only
    # see what the login really committed.
    stored = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_opaque_token(raw_token))
        .execution_options(populate_existing=True)
    )
    assert stored is not None
    me = await client.get(
        f"{API}/auth/me", headers=bearer(response.json()["access_token"])
    )
    assert me.status_code == 200
    assert (await post_refresh(client, raw_token)).status_code == 200


# Logout


async def test_logout_revokes_the_session_and_clears_the_cookie(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)
    raw_token = raw_refresh_token(first)

    response = await post_logout(client, raw_token)

    assert response.status_code == 204
    assert f'{REFRESH_COOKIE}=""' in response.headers["set-cookie"]
    assert (await post_refresh(client, raw_token)).status_code == 401
    family = await family_of(db, first.json()["access_token"])
    assert all(token.revoked_at is not None for token in family)


async def test_logout_invalidates_the_access_token_immediately(
    client: AsyncClient,
) -> None:
    first = await register_owner(client)
    headers = bearer(first.json()["access_token"])
    assert (await client.get(f"{API}/auth/me", headers=headers)).status_code == 200

    await post_logout(client, raw_refresh_token(first))

    assert (await client.get(f"{API}/auth/me", headers=headers)).status_code == 401


async def test_logout_is_idempotent(client: AsyncClient) -> None:
    first = await register_owner(client)
    raw_token = raw_refresh_token(first)

    assert (await post_logout(client, raw_token)).status_code == 204
    assert (await post_logout(client, raw_token)).status_code == 204
    assert (await post_logout(client, "desconhecido")).status_code == 204
    client.cookies.clear()
    assert (
        await client.post(f"{API}/auth/logout", headers=CSRF_HEADER)
    ).status_code == 204


# Origin (D110)


@mark.parametrize("route", ["refresh", "logout"])
@mark.parametrize(
    "origin",
    [
        None,
        "",
        "https://outro.app.test",
        "http://app.test",
        "https://app.test:8443",
        "https://atacante.example.com",
    ],
    ids=["none", "empty", "sibling-subdomain", "http", "other-port", "other-site"],
)
async def test_cookie_routes_refuse_an_origin_outside_the_list(
    client: AsyncClient, db: AsyncSession, route: str, origin: str | None
) -> None:
    first = await register_owner(client)
    raw_token = raw_refresh_token(first)
    client.cookies.clear()
    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": f"{REFRESH_COOKIE}={raw_token}",
    }
    if origin is not None:
        headers["Origin"] = origin

    response = await client.post(f"{API}/auth/{route}", headers=headers)

    assert response.status_code == 403
    assert response.json()["code"] == "ORIGIN_NOT_ALLOWED"
    assert "set-cookie" not in response.headers
    # The token was not touched: it still rotates normally.
    token = await db.scalar(select(RefreshToken))
    assert token is not None
    assert token.used_at is None
    assert token.revoked_at is None


async def test_cookie_routes_accept_any_origin_of_the_list(
    client: AsyncClient, settings: Settings
) -> None:
    second = "https://outra-origem.test"
    settings.cors_allowed_origins = f"{ORIGIN}, {second}"
    first = await register_owner(client)
    client.cookies.clear()

    response = await client.post(
        f"{API}/auth/refresh",
        headers={
            "X-Requested-With": "XMLHttpRequest",
            "Origin": second,
            "Cookie": f"{REFRESH_COOKIE}={raw_refresh_token(first)}",
        },
    )

    assert response.status_code == 200


# CSRF


@mark.parametrize("route", ["refresh", "logout"])
@mark.parametrize("headers", [{}, {"X-Requested-With": "  "}], ids=["none", "blank"])
async def test_ct42_cookie_routes_require_the_csrf_header(
    client: AsyncClient, db: AsyncSession, route: str, headers: dict[str, str]
) -> None:
    first = await register_owner(client)
    raw_token = raw_refresh_token(first)
    client.cookies.clear()

    response = await client.post(
        f"{API}/auth/{route}",
        headers={
            **headers,
            "Origin": ORIGIN,
            "Cookie": f"{REFRESH_COOKIE}={raw_token}",
        },
    )

    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    # The token was not touched: it still rotates normally.
    token = await db.scalar(select(RefreshToken))
    assert token is not None
    assert token.used_at is None
    assert token.revoked_at is None


async def test_login_refuses_a_form_style_cross_site_body(
    client: AsyncClient,
) -> None:
    await register_owner(client)
    client.cookies.clear()

    response = await client.post(
        f"{API}/auth/login",
        content=f'{{"email": "{OWNER_EMAIL}", "password": "{PASSWORD}"}}',
        headers={"Content-Type": "text/plain"},
    )

    assert response.status_code == 422
    assert "set-cookie" not in response.headers


# Access token


async def test_me_requires_a_valid_bearer_token(client: AsyncClient) -> None:
    missing = await client.get(f"{API}/auth/me")
    garbage = await client.get(f"{API}/auth/me", headers=bearer("lixo"))

    for response in (missing, garbage):
        assert response.status_code == 401
        assert response.json()["code"] == "NOT_AUTHENTICATED"
        assert response.headers["www-authenticate"] == "Bearer"


async def test_deactivated_account_loses_access_immediately(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)
    headers = bearer(first.json()["access_token"])

    await deactivate(db, OWNER_EMAIL)

    assert (await client.get(f"{API}/auth/me", headers=headers)).status_code == 401
