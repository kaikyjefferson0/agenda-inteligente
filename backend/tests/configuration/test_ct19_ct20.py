from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

from httpx import AsyncClient, Response
from pytest import fixture, mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Professional, Service, TimeBlock, User
from tests.auth.helpers import API, Clock, bearer, get_user
from tests.configuration.helpers import (
    MONDAY,
    Member,
    add_member,
    create_service,
    get_business,
    interval,
    next_local,
    put_hours,
)

pytestmark = mark.anyio

NEW_SERVICE = {"name": "Novo", "duration_minutes": 30, "price_cents": 100}
NEW_BLOCK = {
    "starts_at": "2030-01-08T10:00:00Z",
    "ends_at": "2030-01-08T11:00:00Z",
    "reason": "Invasão",
}
HOURS = {"intervals": [interval(MONDAY, "01:00", "02:00")]}


@dataclass
class Scene:
    """Resources of the first business, all reachable by their IDs."""

    professional_id: str
    service_id: str
    time_block_id: str
    original_hours: dict[str, Any]


@fixture
async def scene(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> Scene:
    service = await create_service(client, owner_token)
    hours = interval(MONDAY, "09:00", "12:00")
    assert (
        await put_hours(client, owner_token, pro.professional_id, hours)
    ).status_code == 200
    start = next_local(clock.now, MONDAY, "10:00")
    block = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(hours=1)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(owner_token),
    )
    assert block.status_code == 201
    await client.put(
        f"{API}/professionals/{pro.professional_id}/services",
        json={"service_ids": [service["id"]]},
        headers=bearer(owner_token),
    )
    return Scene(pro.professional_id, service["id"], block.json()["id"], hours)


# Every route of this phase that receives an ID.
ROUTES_WITH_ID = [
    ("PATCH", "/services/{service_id}", {"price_cents": 1}),
    ("POST", "/professionals/{professional_id}/deactivate", None),
    ("PUT", "/professionals/{professional_id}/services", {"service_ids": []}),
    ("GET", "/professionals/{professional_id}/working-hours", None),
    ("PUT", "/professionals/{professional_id}/working-hours", HOURS),
    ("GET", "/professionals/{professional_id}/time-blocks", None),
    ("POST", "/professionals/{professional_id}/time-blocks", NEW_BLOCK),
    ("DELETE", "/time-blocks/{time_block_id}", None),
]


def url_for(template: str, scene: Scene) -> str:
    return API + template.format(
        professional_id=scene.professional_id,
        service_id=scene.service_id,
        time_block_id=scene.time_block_id,
    )


async def call(
    client: AsyncClient, method: str, url: str, body: Any, token: str | None = None
) -> Response:
    headers = bearer(token) if token else {}
    return await client.request(method, url, json=body, headers=headers)


async def assert_scene_untouched(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    scene: Scene,
    pro: Member,
) -> None:
    service = await db.get(Service, UUID(scene.service_id), populate_existing=True)
    assert service is not None
    assert service.price_cents == 5000
    professional = await db.get(
        Professional, UUID(scene.professional_id), populate_existing=True
    )
    assert professional is not None
    assert professional.is_bookable is True
    user: User = await get_user(db, pro.email)
    assert user.is_active is True
    assert await db.get(TimeBlock, UUID(scene.time_block_id), populate_existing=True)

    hours = await client.get(
        f"{API}/professionals/{scene.professional_id}/working-hours",
        headers=bearer(owner_token),
    )
    assert hours.json()["intervals"] == [scene.original_hours]
    blocks = await client.get(
        f"{API}/professionals/{scene.professional_id}/time-blocks",
        headers=bearer(owner_token),
    )
    assert [item["id"] for item in blocks.json()] == [scene.time_block_id]
    team = await client.get(f"{API}/professionals", headers=bearer(owner_token))
    linked = next(item for item in team.json() if item["id"] == scene.professional_id)
    assert linked["service_ids"] == [scene.service_id]


# CT19


@mark.parametrize(("method", "template", "body"), ROUTES_WITH_ID)
async def test_ct19_resource_of_another_business_is_not_found(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    other_owner_token: str,
    pro: Member,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
) -> None:
    response = await call(
        client, method, url_for(template, scene), body, other_owner_token
    )

    assert response.status_code == 404, response.text
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "NOT_FOUND"
    await assert_scene_untouched(client, db, owner_token, scene, pro)


@mark.parametrize(("method", "template", "body"), ROUTES_WITH_ID)
async def test_ct19_answer_is_the_same_as_for_a_missing_resource(
    client: AsyncClient,
    other_owner_token: str,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
) -> None:
    missing_id = "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"
    missing = Scene(missing_id, missing_id, missing_id, {})

    foreign = await call(
        client, method, url_for(template, scene), body, other_owner_token
    )
    absent = await call(
        client, method, url_for(template, missing), body, other_owner_token
    )

    assert foreign.status_code == absent.status_code == 404
    assert foreign.json() == absent.json()


@mark.parametrize(("method", "template", "body"), ROUTES_WITH_ID)
async def test_ct19_professional_of_another_business_is_also_not_found(
    client: AsyncClient,
    db: AsyncSession,
    other_owner_token: str,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
) -> None:
    outsider = await add_member(client, db, other_owner_token, "fora@example.com")

    response = await call(
        client, method, url_for(template, scene), body, outsider.token
    )

    # Owner routes refuse the role before looking at the resource.
    expected = 403 if template in OWNER_ONLY_ID_TEMPLATES else 404
    assert response.status_code == expected, response.text


async def test_ct19_service_of_another_business_is_not_found(
    client: AsyncClient,
    owner_token: str,
    other_owner_token: str,
    pro: Member,
    scene: Scene,
) -> None:
    foreign = await create_service(client, other_owner_token, name="De fora")

    response = await client.put(
        f"{API}/professionals/{pro.professional_id}/services",
        json={"service_ids": [scene.service_id, foreign["id"]]},
        headers=bearer(owner_token),
    )

    assert response.status_code == 404
    team = await client.get(f"{API}/professionals", headers=bearer(owner_token))
    linked = next(item for item in team.json() if item["id"] == pro.professional_id)
    assert linked["service_ids"] == [scene.service_id]


async def test_ct19_lists_show_only_the_business_of_the_session(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    other_owner_token: str,
    scene: Scene,
) -> None:
    business = await client.get(f"{API}/business", headers=bearer(other_owner_token))
    services = await client.get(f"{API}/services", headers=bearer(other_owner_token))
    team = await client.get(f"{API}/professionals", headers=bearer(other_owner_token))

    assert business.json()["slug"] == "outro-negocio"
    assert services.json() == []
    assert team.json() == []
    assert (await get_business(db)).slug == "barbearia-um"


@mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/business", {"name": "X"}),
        ("POST", "/services", NEW_SERVICE),
        ("PUT", "/professionals/{professional_id}/working-hours", HOURS),
        ("POST", "/professionals/{professional_id}/time-blocks", NEW_BLOCK),
        ("PUT", "/professionals/{professional_id}/services", {"service_ids": []}),
    ],
)
async def test_ct19_business_id_in_the_body_is_refused(
    client: AsyncClient,
    owner_token: str,
    other_owner_token: str,
    scene: Scene,
    method: str,
    path: str,
    body: dict[str, Any],
) -> None:
    other = await client.get(f"{API}/business", headers=bearer(other_owner_token))

    response = await call(
        client,
        method,
        url_for(path, scene),
        {**body, "business_id": other.json()["id"]},
        owner_token,
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


# CT20

OWNER_ONLY_ROUTES = [
    ("GET", "/business", None),
    ("PATCH", "/business", {"name": "Tomado"}),
    ("POST", "/services", NEW_SERVICE),
    ("PATCH", "/services/{service_id}", {"price_cents": 1}),
    ("POST", "/professionals/me", None),
    ("POST", "/professionals/invitations", {"name": "X", "email": "x@example.com"}),
    ("POST", "/professionals/{professional_id}/deactivate", None),
    ("PUT", "/professionals/{professional_id}/services", {"service_ids": []}),
]
OWNER_ONLY_ID_TEMPLATES = {
    template for _, template, _ in OWNER_ONLY_ROUTES if "{" in template
}
COLLEAGUE_ROUTES = [
    ("GET", "/professionals/{professional_id}/working-hours", None),
    ("PUT", "/professionals/{professional_id}/working-hours", HOURS),
    ("GET", "/professionals/{professional_id}/time-blocks", None),
    ("POST", "/professionals/{professional_id}/time-blocks", NEW_BLOCK),
    ("DELETE", "/time-blocks/{time_block_id}", None),
]


@mark.parametrize(("method", "template", "body"), OWNER_ONLY_ROUTES)
async def test_ct20_professional_cannot_use_owner_routes(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    pro: Member,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
) -> None:
    response = await call(client, method, url_for(template, scene), body, pro.token)

    assert response.status_code == 403, response.text
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "FORBIDDEN"
    await assert_scene_untouched(client, db, owner_token, scene, pro)
    assert (await get_business(db)).name == "Barbearia"


@mark.parametrize(("method", "template", "body"), COLLEAGUE_ROUTES)
async def test_ct20_professional_cannot_touch_the_schedule_of_a_colleague(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    pro: Member,
    colleague: Member,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
) -> None:
    response = await call(
        client, method, url_for(template, scene), body, colleague.token
    )

    assert response.status_code == 403, response.text
    assert response.json()["code"] == "FORBIDDEN"
    await assert_scene_untouched(client, db, owner_token, scene, pro)


@mark.parametrize(
    ("method", "template", "body", "expected"),
    [
        ("GET", "/services", None, 200),
        ("GET", "/professionals", None, 200),
        ("GET", "/professionals/{professional_id}/working-hours", None, 200),
        ("PUT", "/professionals/{professional_id}/working-hours", HOURS, 200),
        ("GET", "/professionals/{professional_id}/time-blocks", None, 200),
        ("POST", "/professionals/{professional_id}/time-blocks", NEW_BLOCK, 201),
        ("DELETE", "/time-blocks/{time_block_id}", None, 204),
    ],
)
async def test_ct20_professional_can_use_the_own_routes(
    client: AsyncClient,
    pro: Member,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
    expected: int,
) -> None:
    response = await call(client, method, url_for(template, scene), body, pro.token)

    assert response.status_code == expected, response.text


@mark.parametrize(
    ("method", "template", "body"),
    [
        *OWNER_ONLY_ROUTES,
        *COLLEAGUE_ROUTES,
        ("GET", "/services", None),
        ("GET", "/professionals", None),
    ],
)
async def test_routes_require_a_session(
    client: AsyncClient,
    scene: Scene,
    method: str,
    template: str,
    body: Any,
) -> None:
    response = await call(client, method, url_for(template, scene), body)

    assert response.status_code == 401, response.text
    assert response.json()["code"] == "NOT_AUTHENTICATED"
