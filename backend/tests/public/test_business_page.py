from typing import Any

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Professional
from tests.auth.helpers import API, bearer, invite
from tests.configuration.helpers import Member, create_service, make_demo
from tests.public.helpers import OTHER_SLUG, SLUG, link_services, page_path

pytestmark = mark.anyio


async def test_page_has_the_business_active_services_and_eligible_professionals(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
) -> None:
    response = await client.get(page_path())

    assert response.status_code == 200
    assert response.json() == {
        "name": "Barbearia",
        "slug": SLUG,
        "timezone": "America/Sao_Paulo",
        "is_demo": False,
        "min_advance_minutes": 60,
        "max_advance_days": 30,
        "services": [
            {
                "id": service["id"],
                "name": "Corte",
                "duration_minutes": 30,
                "price_cents": 5000,
                "professional_ids": [pro.professional_id],
            }
        ],
        "professionals": [{"id": pro.professional_id, "name": "Profissional"}],
    }


async def test_page_does_not_expose_private_data(
    client: AsyncClient, pro: Member
) -> None:
    response = await client.get(page_path())

    assert pro.email not in response.text
    assert "user_id" not in response.text
    assert "preparation_minutes" not in response.text
    assert "is_bookable" not in response.text


async def test_inactive_service_is_not_listed(
    client: AsyncClient, owner_token: str, service: dict[str, Any]
) -> None:
    deactivated = await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )
    assert deactivated.status_code == 200

    assert (await client.get(page_path())).json()["services"] == []


async def test_professional_linked_only_to_an_inactive_service_is_not_listed(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
) -> None:
    await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )

    assert (await client.get(page_path())).json()["professionals"] == []


async def test_professional_who_is_not_bookable_is_not_listed(
    client: AsyncClient, db: AsyncSession, service: dict[str, Any], pro: Member
) -> None:
    await db.execute(update(Professional).values(is_bookable=False))
    await db.commit()

    body = (await client.get(page_path())).json()

    assert body["professionals"] == []
    assert body["services"][0]["professional_ids"] == []


async def test_pending_invitation_is_not_listed(
    client: AsyncClient, owner_token: str, service: dict[str, Any]
) -> None:
    invitation = await invite(client, owner_token, "novo@example.com")
    await link_services(
        client, owner_token, invitation.json()["professional_id"], service["id"]
    )

    assert (await client.get(page_path())).json()["professionals"] == []


async def test_professional_without_a_service_is_not_listed(
    client: AsyncClient, owner_token: str, service: dict[str, Any], pro: Member
) -> None:
    await link_services(client, owner_token, pro.professional_id)

    assert (await client.get(page_path())).json()["professionals"] == []


async def test_service_without_a_professional_is_still_listed(
    client: AsyncClient, owner_token: str, service: dict[str, Any]
) -> None:
    body = (await client.get(page_path())).json()

    assert [item["id"] for item in body["services"]] == [service["id"]]
    assert body["services"][0]["professional_ids"] == []


async def test_professional_serving_two_services_is_listed_once(
    client: AsyncClient, owner_token: str, service: dict[str, Any], pro: Member
) -> None:
    second = await create_service(client, owner_token, name="Barba")
    await link_services(
        client, owner_token, pro.professional_id, service["id"], second["id"]
    )

    body = (await client.get(page_path())).json()

    assert len(body["professionals"]) == 1
    assert [item["name"] for item in body["services"]] == ["Barba", "Corte"]


async def test_demo_business_is_identified(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await make_demo(db)

    assert (await client.get(page_path())).json()["is_demo"] is True


async def test_slug_is_not_case_sensitive(
    client: AsyncClient, owner_token: str
) -> None:
    response = await client.get(page_path(SLUG.upper()))

    assert response.status_code == 200
    assert response.json()["slug"] == SLUG


@mark.parametrize("slug", ["nao-existe", "com%00nulo"])
async def test_unknown_slug_answers_404(client: AsyncClient, slug: str) -> None:
    response = await client.get(page_path(slug))

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


async def test_each_slug_only_shows_its_own_business(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
) -> None:
    mine = (await client.get(page_path())).json()
    theirs = (await client.get(page_path(OTHER_SLUG))).json()

    assert [item["id"] for item in mine["services"]] == [service["id"]]
    assert [item["id"] for item in theirs["services"]] == [other_business["service_id"]]
    assert [item["id"] for item in mine["professionals"]] == [pro.professional_id]
    assert [item["id"] for item in theirs["professionals"]] == [
        other_business["professional_id"]
    ]
