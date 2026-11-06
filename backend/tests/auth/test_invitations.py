import asyncio
from datetime import timedelta

from httpx import AsyncClient
from pytest import fixture, mark
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_opaque_token,
)
from app.models import AccountToken, Business, EmailOutbox, Professional, User
from app.repositories import professionals
from tests.auth.helpers import (
    API,
    OWNER_EMAIL,
    PASSWORD,
    Clock,
    accept,
    bearer,
    get_user,
    invite,
    last_link_token,
    login,
    outbox_for,
    register_owner,
)

pytestmark = mark.anyio

PRO_EMAIL = "pro@example.com"
OTHER_OWNER_EMAIL = "outra-dona@example.com"


@fixture
async def owner_token(client: AsyncClient) -> str:
    return (await register_owner(client)).json()["access_token"]


@fixture
async def other_owner_token(client: AsyncClient, owner_token: str) -> str:
    response = await register_owner(client, "outro-negocio", OTHER_OWNER_EMAIL)
    return response.json()["access_token"]


async def get_professional(db: AsyncSession, user: User) -> Professional:
    professional = await db.scalar(
        select(Professional)
        .where(Professional.user_id == user.id)
        .execution_options(populate_existing=True)
    )
    assert professional is not None
    return professional


async def accepted_professional_token(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> str:
    await invite(client, owner_token, PRO_EMAIL)
    token = await last_link_token(db, PRO_EMAIL)
    assert (await accept(client, token)).status_code == 204
    return (await login(client, PRO_EMAIL)).json()["access_token"]


# Invitation flow (UC04)


async def test_invite_creates_a_pending_account_and_queues_the_email(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str
) -> None:
    response = await invite(client, owner_token)

    assert response.status_code == 202
    body = response.json()
    assert set(body) == {"professional_id", "email", "expires_at"}
    assert "token" not in response.text
    user = await get_user(db, PRO_EMAIL)
    assert user.password_hash is None
    assert user.role == "professional"
    professional = await get_professional(db, user)
    assert str(professional.id) == body["professional_id"]
    assert professional.is_bookable is False
    [message] = await outbox_for(db, PRO_EMAIL)
    assert message.template == "account_invite"
    assert message.status == "pending"
    assert message.payload["business_name"] == "Barbearia"
    assert message.payload["url"].startswith("https://app.test/convite/")
    token = await db.scalar(select(AccountToken))
    assert token is not None
    assert token.purpose == "invite"
    assert token.expires_at == clock.now + timedelta(days=7)
    raw_token = message.payload["url"].rsplit("/", maxsplit=1)[-1]
    assert token.token_hash == hash_opaque_token(raw_token)


async def test_pending_invite_cannot_log_in(
    client: AsyncClient, owner_token: str
) -> None:
    await invite(client, owner_token)

    assert (await login(client, PRO_EMAIL)).status_code == 401


async def test_accept_sets_the_password_and_makes_the_professional_bookable(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    token = await last_link_token(db, PRO_EMAIL)

    response = await accept(client, token)

    assert response.status_code == 204
    user = await get_user(db, PRO_EMAIL)
    assert user.password_hash is not None
    assert PASSWORD not in user.password_hash
    assert (await get_professional(db, user)).is_bookable is True
    session = await login(client, PRO_EMAIL)
    assert session.status_code == 200
    me = await client.get(
        f"{API}/auth/me", headers=bearer(session.json()["access_token"])
    )
    assert me.json()["user"]["role"] == "professional"


# Single use (CT21)


async def test_ct21_invite_token_works_only_once(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    token = await last_link_token(db, PRO_EMAIL)
    assert (await accept(client, token)).status_code == 204

    reused = await accept(client, token, "senha-do-atacante-1")

    assert reused.status_code == 400
    assert reused.json()["code"] == "INVALID_TOKEN"
    assert (await login(client, PRO_EMAIL)).status_code == 200
    attacker = await login(client, PRO_EMAIL, "senha-do-atacante-1")
    assert attacker.status_code == 401


async def test_ct46_concurrent_accepts_have_a_single_winner(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    token = await last_link_token(db, PRO_EMAIL)

    responses = await asyncio.gather(
        accept(client, token, "senha-primeira-111"),
        accept(client, token, "senha-segunda-2222"),
    )

    assert sorted(r.status_code for r in responses) == [204, 400]
    winner = (
        "senha-primeira-111"
        if responses[0].status_code == 204
        else "senha-segunda-2222"
    )
    assert (await login(client, PRO_EMAIL, winner)).status_code == 200


async def test_ct21_invite_expires_after_seven_days(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str
) -> None:
    await invite(client, owner_token)
    token = await last_link_token(db, PRO_EMAIL)
    clock.advance(timedelta(days=7))

    response = await accept(client, token)

    assert response.status_code == 400
    assert (await get_user(db, PRO_EMAIL)).password_hash is None


async def test_reset_link_cannot_be_used_to_accept_an_invite(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await client.post(f"{API}/auth/password/forgot", json={"email": OWNER_EMAIL})
    reset_token = await last_link_token(db, OWNER_EMAIL)

    assert (await accept(client, reset_token)).status_code == 400


async def test_accept_is_refused_after_the_account_is_deactivated(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    token = await last_link_token(db, PRO_EMAIL)
    await db.execute(
        update(User).where(User.email == PRO_EMAIL).values(is_active=False)
    )
    await db.commit()

    assert (await accept(client, token)).status_code == 400


async def test_accept_enforces_the_password_policy(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    token = await last_link_token(db, PRO_EMAIL)

    assert (await accept(client, token, "curta")).status_code == 422
    assert (await accept(client, token)).status_code == 204


# Renewal


async def test_new_invite_replaces_the_previous_link(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    previous = await last_link_token(db, PRO_EMAIL)

    response = await invite(client, owner_token, name="Nome Corrigido")

    assert response.status_code == 202
    latest = await last_link_token(db, PRO_EMAIL)
    assert (await get_user(db, PRO_EMAIL)).name == "Nome Corrigido"
    assert await db.scalar(select(func.count()).select_from(Professional)) == 1
    assert (await accept(client, previous)).status_code == 400
    assert (await accept(client, latest)).status_code == 204


async def test_expired_invite_can_be_renewed(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str
) -> None:
    await invite(client, owner_token)
    clock.advance(timedelta(days=8))

    response = await invite(client, owner_token)

    assert response.status_code == 202
    assert (
        await accept(client, await last_link_token(db, PRO_EMAIL))
    ).status_code == 204


async def test_invite_of_an_accepted_account_is_refused(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await invite(client, owner_token)
    await accept(client, await last_link_token(db, PRO_EMAIL))
    before = await get_user(db, PRO_EMAIL)

    response = await invite(client, owner_token, name="Outro Nome")

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_IN_USE"
    assert (await get_user(db, PRO_EMAIL)).name == before.name


async def test_invite_of_the_owner_email_is_refused(
    client: AsyncClient, owner_token: str
) -> None:
    response = await invite(client, owner_token, OWNER_EMAIL.upper())

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_IN_USE"


async def test_concurrent_invites_of_the_same_email_create_one_account(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    responses = await asyncio.gather(
        invite(client, owner_token), invite(client, owner_token)
    )

    assert all(r.status_code in {202, 409} for r in responses)
    assert any(r.status_code == 202 for r in responses)
    count = await db.scalar(
        select(func.count()).select_from(User).where(User.email == PRO_EMAIL)
    )
    assert count == 1


# Roles (CT20)


async def test_ct20_professional_cannot_invite(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    professional_token = await accepted_professional_token(client, db, owner_token)

    response = await invite(client, professional_token, "outro@example.com")

    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    assert len(await outbox_for(db, "outro@example.com")) == 0


async def test_invite_requires_authentication(client: AsyncClient) -> None:
    response = await client.post(
        f"{API}/professionals/invitations",
        json={"name": "N", "email": PRO_EMAIL},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


# Isolation between businesses (CT19, CT44)


async def test_ct44_invite_uses_the_business_of_the_session(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    other_owner_token: str,
) -> None:
    await invite(client, owner_token)

    invited = await get_user(db, PRO_EMAIL)
    owner = await get_user(db, OWNER_EMAIL)
    other_owner = await get_user(db, OTHER_OWNER_EMAIL)
    assert invited.business_id == owner.business_id
    assert invited.business_id != other_owner.business_id


async def test_ct44_business_id_sent_by_the_client_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    other_owner_token: str,
) -> None:
    other = await get_user(db, OTHER_OWNER_EMAIL)

    response = await client.post(
        f"{API}/professionals/invitations",
        json={
            "name": "Intrusa",
            "email": PRO_EMAIL,
            "business_id": str(other.business_id),
        },
        headers=bearer(owner_token),
    )

    assert response.status_code == 422
    count = await db.scalar(
        select(func.count()).select_from(User).where(User.email == PRO_EMAIL)
    )
    assert count == 0


async def test_ct44_pending_invite_of_another_business_stays_untouched(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    other_owner_token: str,
) -> None:
    await invite(client, other_owner_token, name="Da Outra")
    token = await last_link_token(db, PRO_EMAIL)
    other_business = (await get_user(db, PRO_EMAIL)).business_id

    response = await invite(client, owner_token, name="Sequestro")

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_IN_USE"
    user = await get_user(db, PRO_EMAIL)
    assert user.name == "Da Outra"
    assert user.business_id == other_business
    assert len(await outbox_for(db, PRO_EMAIL)) == 1
    assert (await accept(client, token)).status_code == 204


async def test_ct44_each_session_sees_only_its_own_business(
    client: AsyncClient, owner_token: str, other_owner_token: str
) -> None:
    mine = await client.get(f"{API}/auth/me", headers=bearer(owner_token))
    theirs = await client.get(f"{API}/auth/me", headers=bearer(other_owner_token))

    assert mine.json()["business"]["slug"] == "barbearia-um"
    assert theirs.json()["business"]["slug"] == "outro-negocio"


async def test_ct44_repository_does_not_cross_businesses(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    other_owner_token: str,
) -> None:
    await invite(client, owner_token)
    user = await get_user(db, PRO_EMAIL)
    other = await get_user(db, OTHER_OWNER_EMAIL)

    assert await professionals.get_by_user(db, user.business_id, user.id) is not None
    assert await professionals.get_by_user(db, other.business_id, user.id) is None


async def test_ct44_token_with_the_family_of_another_user_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    settings: Settings,
    owner_token: str,
    other_owner_token: str,
) -> None:
    victim = await get_user(db, OTHER_OWNER_EMAIL)
    _, attacker_family = decode_access_token(owner_token, settings.jwt_secret)
    forged = create_access_token(
        victim.id, attacker_family, clock.now, settings.jwt_secret
    )

    response = await client.get(f"{API}/auth/me", headers=bearer(forged))

    assert response.status_code == 401


# Demo and limits


async def test_ct32_demo_business_cannot_invite(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await db.execute(update(Business).values(is_demo=True))
    await db.commit()

    response = await invite(client, owner_token)

    assert response.status_code == 403
    assert response.json()["code"] == "DEMO_RESTRICTED"
    assert await db.scalar(select(func.count()).select_from(EmailOutbox)) == 0
    count = await db.scalar(
        select(func.count()).select_from(User).where(User.email == PRO_EMAIL)
    )
    assert count == 0


async def test_invitations_are_limited_per_business(
    client: AsyncClient, owner_token: str, other_owner_token: str
) -> None:
    for index in range(20):
        response = await invite(client, owner_token, f"p{index}@example.com")
        assert response.status_code == 202

    limited = await invite(client, owner_token, "mais-um@example.com")
    other_business = await invite(client, other_owner_token, "dela@example.com")

    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"
    assert int(limited.headers["retry-after"]) > 0
    assert other_business.status_code == 202


async def test_email_cap_refuses_the_invite_without_creating_anything(
    client: AsyncClient, db: AsyncSession, settings: Settings, owner_token: str
) -> None:
    settings.email_daily_cap = 0

    response = await invite(client, owner_token)

    assert response.status_code == 429
    assert response.json()["code"] == "RATE_LIMITED"
    assert int(response.headers["retry-after"]) > 0
    assert await db.scalar(select(func.count()).select_from(Professional)) == 0
    assert await db.scalar(select(func.count()).select_from(EmailOutbox)) == 0
    assert await db.scalar(select(func.count()).select_from(AccountToken)) == 0
    count = await db.scalar(
        select(func.count()).select_from(User).where(User.email == PRO_EMAIL)
    )
    assert count == 0


async def test_recipient_cap_keeps_the_previous_invite_valid(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    for _ in range(3):
        assert (await invite(client, owner_token)).status_code == 202
    latest = await last_link_token(db, PRO_EMAIL)

    capped = await invite(client, owner_token)

    assert capped.status_code == 429
    assert (await accept(client, latest)).status_code == 204


async def test_accept_attempts_are_limited_per_ip(client: AsyncClient) -> None:
    for _ in range(10):
        assert (await accept(client, "nao-existe")).status_code == 400

    assert (await accept(client, "nao-existe")).status_code == 429
