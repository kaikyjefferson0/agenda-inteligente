from typing import Any
from uuid import UUID

from httpx import AsyncClient
from pytest import mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, Service
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    MONDAY,
    Member,
    create_service,
    make_appointment,
    make_demo,
    next_local,
)

pytestmark = mark.anyio

VALID_SERVICE = {"name": "Corte", "duration_minutes": 30, "price_cents": 5000}


async def patch_service(client: AsyncClient, token: str, service_id: str, **body: Any):
    return await client.patch(
        f"{API}/services/{service_id}", json=body, headers=bearer(token)
    )


async def test_create_uses_the_default_preparation(
    client: AsyncClient, owner_token: str
) -> None:
    body = await create_service(client, owner_token)

    assert body.pop("id")
    assert body == {
        "name": "Corte",
        "duration_minutes": 30,
        "preparation_minutes": 0,
        "price_cents": 5000,
        "is_active": True,
    }


async def test_list_includes_inactive_services_and_a_professional_can_read_it(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    barba = await create_service(client, owner_token, name="Barba")
    corte = await create_service(client, owner_token, name="Corte")
    await patch_service(client, owner_token, corte["id"], is_active=False)

    response = await client.get(f"{API}/services", headers=bearer(pro.token))

    assert response.status_code == 200
    assert [(item["id"], item["is_active"]) for item in response.json()] == [
        (barba["id"], True),
        (corte["id"], False),
    ]


async def test_patch_changes_only_the_fields_sent(
    client: AsyncClient, owner_token: str
) -> None:
    service = await create_service(client, owner_token, preparation_minutes=10)

    response = await patch_service(
        client, owner_token, service["id"], price_cents=7000, name="  Corte longo "
    )

    assert response.status_code == 200
    assert response.json() == {
        **service,
        "name": "Corte longo",
        "price_cents": 7000,
    }


async def test_service_with_history_is_deactivated_and_stays_available_to_it(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    appointment = await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "10:00"),
    )

    deactivated = await patch_service(
        client, owner_token, service["id"], is_active=False, price_cents=9000
    )

    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False
    stored = await db.get(Service, UUID(service["id"]), populate_existing=True)
    assert stored is not None
    assert stored.is_active is False
    # RN11: the appointment keeps the copy made when it was booked.
    kept = await db.get(Appointment, appointment.id, populate_existing=True)
    assert kept is not None
    assert kept.price_cents == 5000

    reactivated = await patch_service(
        client, owner_token, service["id"], is_active=True
    )

    assert reactivated.json()["is_active"] is True


async def test_services_cannot_be_deleted(
    client: AsyncClient, owner_token: str
) -> None:
    service = await create_service(client, owner_token)

    response = await client.delete(
        f"{API}/services/{service['id']}", headers=bearer(owner_token)
    )

    assert response.status_code == 405


@mark.parametrize(
    "changes",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"duration_minutes": 0},
        {"duration_minutes": 1441},
        {"duration_minutes": 2147483648},
        {"preparation_minutes": -1},
        {"preparation_minutes": 1441},
        {"price_cents": -1},
        {"price_cents": 100000001},
        {"business_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"},
    ],
)
async def test_create_refuses_invalid_values(
    client: AsyncClient, owner_token: str, changes: dict[str, Any]
) -> None:
    response = await client.post(
        f"{API}/services",
        json={**VALID_SERVICE, **changes},
        headers=bearer(owner_token),
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


@mark.parametrize("field", ["name", "duration_minutes", "price_cents"])
async def test_create_requires_the_main_fields(
    client: AsyncClient, owner_token: str, field: str
) -> None:
    body = {key: value for key, value in VALID_SERVICE.items() if key != field}

    response = await client.post(
        f"{API}/services", json=body, headers=bearer(owner_token)
    )

    assert response.status_code == 422


@mark.parametrize(
    "changes",
    [
        {"name": None},
        {"duration_minutes": None},
        {"is_active": None},
        {"duration_minutes": 0},
        {"unknown": 1},
    ],
)
async def test_patch_refuses_invalid_values(
    client: AsyncClient, owner_token: str, changes: dict[str, Any]
) -> None:
    service = await create_service(client, owner_token)

    response = await patch_service(client, owner_token, service["id"], **changes)

    assert response.status_code == 422, response.text


async def test_patch_of_a_missing_service_is_not_found(
    client: AsyncClient, owner_token: str
) -> None:
    response = await patch_service(
        client, owner_token, "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20", price_cents=1
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


# CT32, services part


async def test_ct32_demo_cannot_create_a_service(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await make_demo(db)

    response = await client.post(
        f"{API}/services", json=VALID_SERVICE, headers=bearer(owner_token)
    )

    assert response.status_code == 403
    assert response.json()["code"] == "DEMO_RESTRICTED"
    listed = await client.get(f"{API}/services", headers=bearer(owner_token))
    assert listed.json() == []


async def test_ct32_demo_cannot_rename_a_service(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    service = await create_service(client, owner_token)
    await make_demo(db)

    response = await patch_service(
        client, owner_token, service["id"], name="Outro nome", price_cents=1
    )

    assert response.status_code == 403
    assert response.json()["code"] == "DEMO_RESTRICTED"
    stored = await db.get(Service, UUID(service["id"]), populate_existing=True)
    assert stored is not None
    assert stored.name == "Corte"
    assert stored.price_cents == 5000


async def test_ct32_demo_can_edit_what_is_not_locked(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    service = await create_service(client, owner_token)
    await make_demo(db)

    response = await patch_service(
        client,
        owner_token,
        service["id"],
        name="Corte",
        duration_minutes=45,
        preparation_minutes=5,
        price_cents=6000,
        is_active=False,
    )

    assert response.status_code == 200
    assert response.json()["duration_minutes"] == 45
    assert response.json()["is_active"] is False
