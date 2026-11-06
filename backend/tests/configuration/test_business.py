from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, AppointmentStatus
from tests.auth.helpers import API, Clock, bearer, register_owner
from tests.configuration.helpers import (
    MONDAY,
    Member,
    create_service,
    get_business,
    interval,
    iso_utc,
    make_appointment,
    make_demo,
    next_local,
    put_hours,
)

pytestmark = mark.anyio


async def patch_business(client: AsyncClient, token: str, **body: Any):
    return await client.patch(f"{API}/business", json=body, headers=bearer(token))


async def test_get_returns_the_default_settings(
    client: AsyncClient, owner_token: str
) -> None:
    response = await client.get(f"{API}/business", headers=bearer(owner_token))

    assert response.status_code == 200
    body = response.json()
    assert body.pop("id")
    assert body == {
        "name": "Barbearia",
        "slug": "barbearia-um",
        "timezone": "America/Sao_Paulo",
        "slot_step_minutes": 15,
        "min_advance_minutes": 60,
        "max_advance_days": 30,
        "change_deadline_minutes": 120,
        "is_demo": False,
    }


async def test_patch_changes_only_the_fields_sent(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    response = await patch_business(
        client, owner_token, name="  Novo nome  ", slot_step_minutes=30
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Novo nome"
    assert body["slot_step_minutes"] == 30
    assert body["appointments_outside_hours"] == []
    business = await get_business(db)
    assert business.name == "Novo nome"
    assert business.slot_step_minutes == 30
    assert business.change_deadline_minutes == 120


async def test_empty_patch_changes_nothing(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    before = (await get_business(db)).updated_at

    response = await patch_business(client, owner_token)

    assert response.status_code == 200
    assert (await get_business(db)).updated_at == before


async def test_slug_in_use_is_refused(
    client: AsyncClient, db: AsyncSession, owner_token: str, other_owner_token: str
) -> None:
    response = await patch_business(client, owner_token, slug="outro-negocio")

    assert response.status_code == 409
    assert response.json()["code"] == "SLUG_IN_USE"
    assert (await get_business(db)).slug == "barbearia-um"


async def test_slug_can_change_to_a_free_one(
    client: AsyncClient, owner_token: str
) -> None:
    response = await patch_business(client, owner_token, slug="novo-endereco")

    assert response.status_code == 200
    assert response.json()["slug"] == "novo-endereco"


@mark.parametrize(
    "body",
    [
        {"slot_step_minutes": 7},
        {"min_advance_minutes": -1},
        {"min_advance_minutes": 525601},
        {"max_advance_days": 0},
        {"max_advance_days": 366},
        {"change_deadline_minutes": -1},
        {"change_deadline_minutes": 43201},
        {"change_deadline_minutes": 2147483648},
        {"timezone": "Marte/Base"},
        {"slug": "Com-Maiuscula"},
        {"slug": "ab"},
        {"name": "   "},
        {"name": None},
        {"timezone": None},
        {"slot_step_minutes": None},
        {"is_demo": True},
        {"business_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"},
    ],
)
async def test_invalid_values_are_refused(
    client: AsyncClient, db: AsyncSession, owner_token: str, body: dict[str, Any]
) -> None:
    response = await patch_business(client, owner_token, **body)

    assert response.status_code == 422, response.text
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "VALIDATION_ERROR"
    business = await get_business(db)
    assert business.name == "Barbearia"
    assert business.is_demo is False


@mark.parametrize(
    "body",
    [
        {"min_advance_minutes": 30 * 1440 + 1},
        {"max_advance_days": 1, "min_advance_minutes": 1441},
    ],
)
async def test_minimum_advance_above_the_maximum_is_refused(
    client: AsyncClient, db: AsyncSession, owner_token: str, body: dict[str, Any]
) -> None:
    response = await patch_business(client, owner_token, **body)

    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "min_advance_minutes"]
    assert (await get_business(db)).min_advance_minutes == 60


async def test_maximum_advance_is_checked_against_the_stored_minimum(
    client: AsyncClient, owner_token: str
) -> None:
    await patch_business(client, owner_token, min_advance_minutes=2 * 1440)

    response = await patch_business(client, owner_token, max_advance_days=1)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


async def test_changing_the_time_zone_lists_appointments_left_outside(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
    colleague: Member,
) -> None:
    service = await create_service(client, owner_token)
    service_id = service["id"]
    hours = interval(MONDAY, "09:00", "18:00")
    await put_hours(client, owner_token, pro.professional_id, hours)
    await put_hours(client, owner_token, colleague.professional_id, hours)
    # America/Manaus is one hour behind São Paulo.
    now = clock.now
    still_inside = next_local(now, MONDAY, "12:00")
    left_outside = next_local(now, MONDAY, "09:30")
    colleague_outside = next_local(now, MONDAY, "09:00")
    await make_appointment(db, pro.professional_id, service_id, still_inside)
    outside = await make_appointment(db, pro.professional_id, service_id, left_outside)
    other = await make_appointment(
        db, colleague.professional_id, service_id, colleague_outside
    )

    response = await patch_business(client, owner_token, timezone="America/Manaus")

    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "America/Manaus"
    # The same format as the working hours response, ordered by start.
    assert [item["id"] for item in body["appointments_outside_hours"]] == [
        str(other.id),
        str(outside.id),
    ]
    assert body["appointments_outside_hours"][1] == {
        "id": str(outside.id),
        "professional_id": pro.professional_id,
        "service_id": service_id,
        "starts_at": iso_utc(left_outside),
        "ends_at": iso_utc(outside.ends_at),
        "blocked_until": iso_utc(outside.blocked_until),
        "status": "confirmed",
        "customer_name": "Cliente de Teste",
    }


async def test_changing_the_time_zone_keeps_the_appointments(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "09:30")
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], starts_at
    )

    response = await patch_business(client, owner_token, timezone="Asia/Tokyo")

    assert response.status_code == 200
    stored = await db.scalar(
        select(Appointment)
        .where(Appointment.id == appointment.id)
        .execution_options(populate_existing=True)
    )
    assert stored is not None
    assert stored.starts_at == starts_at
    assert stored.status is AppointmentStatus.CONFIRMED


async def test_time_zone_report_ignores_past_and_non_confirmed_appointments(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    service_id = service["id"]
    starts_at = next_local(clock.now, MONDAY, "09:30")
    await make_appointment(
        db,
        pro.professional_id,
        service_id,
        starts_at,
        status=AppointmentStatus.CANCELLED,
    )
    await make_appointment(
        db,
        pro.professional_id,
        service_id,
        next_local(clock.now, MONDAY, "11:00"),
        status=AppointmentStatus.NO_SHOW,
    )
    await make_appointment(
        db, pro.professional_id, service_id, clock.now - timedelta(days=1)
    )

    response = await patch_business(client, owner_token, timezone="Asia/Tokyo")

    assert response.status_code == 200
    assert response.json()["appointments_outside_hours"] == []


async def test_report_is_empty_when_the_time_zone_does_not_change(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    # No working hours at all, so this appointment is already outside of them.
    await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "10:00"),
    )

    same_zone = await patch_business(client, owner_token, timezone="America/Sao_Paulo")
    other_field = await patch_business(client, owner_token, slot_step_minutes=30)

    assert same_zone.json()["appointments_outside_hours"] == []
    assert other_field.json()["appointments_outside_hours"] == []


# CT32, business part


@mark.parametrize(
    "body",
    [
        {"name": "Outro nome"},
        {"slug": "outro-endereco"},
        {"name": "Outro nome", "slot_step_minutes": 30},
    ],
)
async def test_ct32_demo_cannot_change_locked_fields(
    client: AsyncClient, db: AsyncSession, owner_token: str, body: dict[str, Any]
) -> None:
    await make_demo(db)

    response = await patch_business(client, owner_token, **body)

    assert response.status_code == 403
    assert response.json()["code"] == "DEMO_RESTRICTED"
    business = await get_business(db)
    assert business.name == "Barbearia"
    assert business.slug == "barbearia-um"
    assert business.slot_step_minutes == 15


async def test_ct32_demo_accepts_locked_fields_with_the_same_value(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await make_demo(db)

    response = await patch_business(
        client,
        owner_token,
        name="Barbearia",
        slug="barbearia-um",
        slot_step_minutes=30,
    )

    assert response.status_code == 200
    assert response.json()["slot_step_minutes"] == 30


async def test_ct32_demo_can_change_the_fields_that_are_not_locked(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    await make_demo(db)

    response = await patch_business(
        client,
        owner_token,
        timezone="America/Manaus",
        slot_step_minutes=10,
        min_advance_minutes=0,
        max_advance_days=10,
        change_deadline_minutes=30,
    )

    assert response.status_code == 200
    assert response.json()["is_demo"] is True
    assert response.json()["timezone"] == "America/Manaus"


async def test_settings_of_one_business_do_not_touch_another(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    other = await register_owner(client, "outro-negocio", "outra@example.com")

    response = await patch_business(
        client, other.json()["access_token"], slot_step_minutes=60
    )

    assert response.status_code == 200
    assert (await get_business(db)).slot_step_minutes == 15
    assert (await get_business(db, "outro-negocio")).slot_step_minutes == 60
