from datetime import timedelta

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_opaque_token
from app.models import AccountToken, Business, EmailOutbox
from tests.auth.helpers import (
    API,
    OTHER_PASSWORD,
    OWNER_EMAIL,
    PASSWORD,
    Clock,
    bearer,
    deactivate,
    family_of,
    get_user,
    invite,
    last_link_token,
    login,
    outbox_for,
    post_refresh,
    raw_refresh_token,
    register_owner,
)

pytestmark = mark.anyio

PENDING_EMAIL = "pendente@example.com"


async def forgot(client: AsyncClient, email: str = OWNER_EMAIL) -> Response:
    return await client.post(f"{API}/auth/password/forgot", json={"email": email})


async def reset(
    client: AsyncClient, token: str, new_password: str = OTHER_PASSWORD
) -> Response:
    return await client.post(
        f"{API}/auth/password/reset",
        json={"token": token, "new_password": new_password},
    )


async def test_ct39_forgot_answers_the_same_for_any_account_state(
    client: AsyncClient, db: AsyncSession
) -> None:
    owner = await register_owner(client)
    await invite(client, owner.json()["access_token"], PENDING_EMAIL)
    await register_second_owner_inactive(client, db)
    pending_before = len(await outbox_for(db, PENDING_EMAIL))

    responses = [
        await forgot(client, "ninguem@example.com"),
        await forgot(client, PENDING_EMAIL),
        await forgot(client, "inativa@example.com"),
        await forgot(client, OWNER_EMAIL),
    ]

    assert {r.status_code for r in responses} == {202}
    assert len({r.content for r in responses}) == 1
    assert len(await outbox_for(db, "ninguem@example.com")) == 0
    assert len(await outbox_for(db, PENDING_EMAIL)) == pending_before
    assert len(await outbox_for(db, "inativa@example.com")) == 0
    assert len(await outbox_for(db, OWNER_EMAIL)) == 1


async def register_second_owner_inactive(client: AsyncClient, db: AsyncSession) -> None:
    await register_owner(client, "negocio-inativo", "inativa@example.com")
    await deactivate(db, "inativa@example.com")


async def test_forgot_stores_the_hash_and_queues_only_the_link(
    client: AsyncClient, db: AsyncSession, clock: Clock
) -> None:
    await register_owner(client)

    await forgot(client)

    [message] = await outbox_for(db, OWNER_EMAIL)
    assert message.template == "password_reset"
    assert message.status == "pending"
    url = message.payload["url"]
    assert url.startswith("https://app.test/recuperar-senha/")
    raw_token = url.rsplit("/", maxsplit=1)[-1]
    token = await db.scalar(select(AccountToken))
    assert token is not None
    assert token.purpose == "password_reset"
    assert token.token_hash == hash_opaque_token(raw_token)
    assert token.expires_at == clock.now + timedelta(hours=1)


async def test_ct40_reset_changes_the_password_and_revokes_all_sessions(
    client: AsyncClient, db: AsyncSession
) -> None:
    first = await register_owner(client)
    second = await login(client)
    headers = bearer(first.json()["access_token"])
    await forgot(client)
    token = await last_link_token(db, OWNER_EMAIL)

    response = await reset(client, token)

    assert response.status_code == 204
    assert (await login(client, password=PASSWORD)).status_code == 401
    assert (await post_refresh(client, raw_refresh_token(first))).status_code == 401
    assert (await post_refresh(client, raw_refresh_token(second))).status_code == 401
    # CT40: the access token dies with the session, without waiting 15 minutes.
    assert (await client.get(f"{API}/auth/me", headers=headers)).status_code == 401
    for session in (first, second):
        family = await family_of(db, session.json()["access_token"])
        assert all(token.revoked_at is not None for token in family)
    assert (await login(client, password=OTHER_PASSWORD)).status_code == 200


async def test_ct21_reset_link_works_only_once(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)
    await forgot(client)
    token = await last_link_token(db, OWNER_EMAIL)
    assert (await reset(client, token)).status_code == 204

    reused = await reset(client, token, "mais-uma-senha-forte")

    assert reused.status_code == 400
    assert reused.json()["code"] == "INVALID_TOKEN"
    assert (await login(client, password=OTHER_PASSWORD)).status_code == 200


async def test_ct21_reset_link_expires_after_one_hour(
    client: AsyncClient, db: AsyncSession, clock: Clock
) -> None:
    await register_owner(client)
    await forgot(client)
    token = await last_link_token(db, OWNER_EMAIL)
    clock.advance(timedelta(hours=1))

    response = await reset(client, token)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_TOKEN"
    assert (await login(client)).status_code == 200


async def test_new_request_invalidates_the_previous_reset_link(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)
    await forgot(client)
    previous = await last_link_token(db, OWNER_EMAIL)
    await forgot(client)
    latest = await last_link_token(db, OWNER_EMAIL)

    assert (await reset(client, previous)).status_code == 400
    assert (await reset(client, latest)).status_code == 204


async def test_invite_link_cannot_be_used_to_reset_a_password(
    client: AsyncClient, db: AsyncSession
) -> None:
    owner = await register_owner(client)
    await invite(client, owner.json()["access_token"], PENDING_EMAIL)
    invite_token = await last_link_token(db, PENDING_EMAIL)

    assert (await reset(client, invite_token)).status_code == 400
    assert (await get_user(db, PENDING_EMAIL)).password_hash is None


async def test_reset_is_refused_after_the_account_is_deactivated(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)
    await forgot(client)
    token = await last_link_token(db, OWNER_EMAIL)
    await deactivate(db, OWNER_EMAIL)

    assert (await reset(client, token)).status_code == 400


async def test_unknown_reset_token_is_refused(client: AsyncClient) -> None:
    response = await reset(client, "nao-existe")

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_TOKEN"


async def test_reset_enforces_the_password_policy(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)
    await forgot(client)
    token = await last_link_token(db, OWNER_EMAIL)

    response = await reset(client, token, "curta")

    assert response.status_code == 422
    # The link was not spent by the refused attempt.
    assert (await reset(client, token)).status_code == 204


async def test_forgot_is_limited_per_ip_for_any_email(client: AsyncClient) -> None:
    for index in range(5):
        response = await forgot(client, f"p{index}@example.com")
        assert response.status_code == 202

    limited = await forgot(client, "outro@example.com")

    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"
    assert int(limited.headers["retry-after"]) > 0


async def test_reset_attempts_are_limited_per_ip(client: AsyncClient) -> None:
    for _ in range(10):
        assert (await reset(client, "nao-existe")).status_code == 400

    assert (await reset(client, "nao-existe")).status_code == 429


async def test_recipient_cap_stops_queueing_but_still_answers_202(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)
    for _ in range(3):
        await forgot(client)
    previous = await last_link_token(db, OWNER_EMAIL)

    capped = await forgot(client)

    assert capped.status_code == 202
    assert len(await outbox_for(db, OWNER_EMAIL)) == 3
    # The link in the recipient's inbox keeps working.
    assert (await reset(client, previous)).status_code == 204


async def test_global_cap_stops_queueing_but_still_answers_202(
    client: AsyncClient, db: AsyncSession, settings: Settings
) -> None:
    await register_owner(client)
    await register_owner(client, "negocio-dois", "dois@example.com")
    settings.email_daily_cap = 1
    await forgot(client, OWNER_EMAIL)

    capped = await forgot(client, "dois@example.com")

    assert capped.status_code == 202
    assert len(await outbox_for(db, OWNER_EMAIL)) == 1
    assert len(await outbox_for(db, "dois@example.com")) == 0


async def test_ct32_demo_business_answers_202_without_queueing(
    client: AsyncClient, db: AsyncSession
) -> None:
    await register_owner(client)
    await db.execute(update(Business).values(is_demo=True))
    await db.commit()

    response = await forgot(client)

    assert response.status_code == 202
    assert await db.scalar(select(func.count()).select_from(EmailOutbox)) == 0
    assert await db.scalar(select(func.count()).select_from(AccountToken)) == 0
