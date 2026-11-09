"""The restored demo through the API: accounts, sessions, agenda, page and RN28."""

from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from pytest import fixture, mark
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import Settings
from app.services import demo_content as content
from tests.appointments.helpers import get_agenda
from tests.auth.helpers import (
    API,
    Clock,
    bearer,
    invite,
    login,
    outbox_for,
    post_refresh,
    raw_refresh_token,
)
from tests.demo.helpers import (
    DEMO_PASSWORD,
    OWNER_EMAIL,
    PROFESSIONAL_EMAIL,
    next_working_day,
    restore,
)
from tests.public.helpers import (
    booking_body,
    get_availability,
    offered,
    page_path,
    post_booking,
)

pytestmark = mark.anyio


@fixture
async def demo(
    engine: AsyncEngine, settings: Settings, clock: Clock, hasher: Any
) -> None:
    await restore(engine, settings, clock.now)


async def owner_token(client: AsyncClient) -> str:
    response = await login(client, OWNER_EMAIL, DEMO_PASSWORD)
    assert response.status_code == 200, response.text
    token: str = response.json()["access_token"]
    return token


# CT65


@mark.parametrize("email", [OWNER_EMAIL, PROFESSIONAL_EMAIL])
async def test_ct65_both_accounts_log_in_with_the_demo_password(
    client: AsyncClient, demo: None, email: str
) -> None:
    response = await login(client, email, DEMO_PASSWORD)

    assert response.status_code == 200, response.text
    me = await client.get(
        f"{API}/auth/me", headers=bearer(response.json()["access_token"])
    )
    assert me.json()["business"] == {
        "id": str(content.BUSINESS_ID),
        "name": "Barbearia Demo",
        "slug": "barbearia-demo",
        "timezone": "America/Sao_Paulo",
        "is_demo": True,
    }
    expected_role = "owner" if email == OWNER_EMAIL else "professional"
    assert me.json()["user"]["role"] == expected_role


async def test_ct65_previous_sessions_stop_working(
    client: AsyncClient,
    engine: AsyncEngine,
    settings: Settings,
    clock: Clock,
    demo: None,
) -> None:
    before = await login(client, PROFESSIONAL_EMAIL, DEMO_PASSWORD)
    access_token = before.json()["access_token"]
    refresh = raw_refresh_token(before)

    await restore(engine, settings, clock.now)

    me = await client.get(f"{API}/auth/me", headers=bearer(access_token))
    assert me.status_code == 401
    assert (await post_refresh(client, refresh)).status_code == 401
    again = await login(client, PROFESSIONAL_EMAIL, DEMO_PASSWORD)
    assert again.status_code == 200


async def test_ct65_the_public_page_has_free_times_for_every_service(
    client: AsyncClient, clock: Clock, demo: None
) -> None:
    page = await client.get(page_path(content.SLUG))
    assert page.status_code == 200
    assert page.json()["is_demo"] is True
    assert {item["id"] for item in page.json()["professionals"]} == {
        str(content.OWNER.professional_id),
        str(content.PROFESSIONAL.professional_id),
    }
    day = next_working_day(clock.now).isoformat()

    for service in content.SERVICES:
        for account in content.ACCOUNTS:
            if service not in content.SERVICES_BY_PROFESSIONAL[account.professional_id]:
                continue
            response = await get_availability(
                client,
                str(service.id),
                day,
                professional_id=str(account.professional_id),
                slug=content.SLUG,
            )
            assert offered(response), (service.name, account.name)


async def test_ct65_the_agenda_has_past_and_future_appointments(
    client: AsyncClient, clock: Clock, demo: None
) -> None:
    token = await owner_token(client)

    response = await get_agenda(
        client, token, clock.now - timedelta(days=8), clock.now + timedelta(days=8)
    )

    assert response.status_code == 200, response.text
    items = response.json()
    starts = [item["starts_at"] for item in items]
    now = clock.now.isoformat().replace("+00:00", "Z")
    assert any(start < now for start in starts)
    assert any(start > now for start in starts)
    statuses = {item["status"] for item in items}
    assert statuses == {"confirmed", "completed", "no_show", "cancelled"}
    professionals = {item["professional_id"] for item in items}
    assert professionals == {
        str(content.OWNER.professional_id),
        str(content.PROFESSIONAL.professional_id),
    }
    # The Profissional sees their own agenda only.
    pro = await login(client, PROFESSIONAL_EMAIL, DEMO_PASSWORD)
    own = await get_agenda(
        client,
        pro.json()["access_token"],
        clock.now - timedelta(days=8),
        clock.now + timedelta(days=8),
    )
    assert {item["professional_id"] for item in own.json()} == {
        str(content.PROFESSIONAL.professional_id)
    }


async def test_a_public_booking_on_a_free_time_is_accepted(
    client: AsyncClient, clock: Clock, demo: None
) -> None:
    haircut = str(content.HAIRCUT.id)
    day = next_working_day(clock.now).isoformat()
    free = offered(await get_availability(client, haircut, day, slug=content.SLUG))

    response = await post_booking(
        client, booking_body(haircut, free[0]), slug=content.SLUG
    )

    assert response.status_code == 201, response.text
    assert response.json()["starts_at"] == free[0]
    assert response.json()["access_url"]
    # D15: the booking works as in any business, e-mail included.
    after = offered(await get_availability(client, haircut, day, slug=content.SLUG))
    assert len(after) < len(free)


# CT32 on the restored demo


async def test_ct32_the_locks_of_rn28_still_apply(
    client: AsyncClient, db: AsyncSession, demo: None
) -> None:
    headers = bearer(await owner_token(client))

    renamed = await client.patch(
        f"{API}/business", json={"name": "Outro nome"}, headers=headers
    )
    new_slug = await client.patch(
        f"{API}/business", json={"slug": "outro-slug"}, headers=headers
    )
    created = await client.post(
        f"{API}/services",
        json={"name": "Novo", "duration_minutes": 30, "price_cents": 1000},
        headers=headers,
    )
    service_renamed = await client.patch(
        f"{API}/services/{content.HAIRCUT.id}",
        json={"name": "Outro corte"},
        headers=headers,
    )
    invited = await invite(client, headers["Authorization"].removeprefix("Bearer "))
    forgot = await client.post(
        f"{API}/auth/password/forgot", json={"email": OWNER_EMAIL}
    )

    for response in (renamed, new_slug, created, service_renamed, invited):
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "DEMO_RESTRICTED"
    assert forgot.status_code == 202
    assert await outbox_for(db, OWNER_EMAIL) == []
    assert await outbox_for(db, "pro@example.com") == []
