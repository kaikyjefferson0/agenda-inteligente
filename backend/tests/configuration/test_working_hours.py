from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, AppointmentStatus
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    MONDAY,
    TUESDAY,
    Member,
    create_service,
    interval,
    iso_utc,
    make_appointment,
    next_local,
    put_hours,
)

pytestmark = mark.anyio


async def get_hours(client: AsyncClient, token: str, professional_id: str) -> Any:
    response = await client.get(
        f"{API}/professionals/{professional_id}/working-hours", headers=bearer(token)
    )
    assert response.status_code == 200
    return response.json()


async def test_starts_empty(client: AsyncClient, owner_token: str, pro: Member) -> None:
    body = await get_hours(client, owner_token, pro.professional_id)

    assert body == {"intervals": []}


async def test_put_stores_lunch_as_two_intervals_in_order(
    client: AsyncClient, pro: Member
) -> None:
    afternoon = interval(MONDAY, "13:00", "18:00")
    morning = interval(MONDAY, "09:00", "12:00")
    tuesday = interval(TUESDAY, "10:00", "11:00")

    response = await put_hours(
        client, pro.token, pro.professional_id, tuesday, afternoon, morning
    )

    assert response.status_code == 200
    expected = [morning, afternoon, tuesday]
    assert response.json() == {
        "intervals": expected,
        "appointments_outside_hours": [],
    }
    assert await get_hours(client, pro.token, pro.professional_id) == {
        "intervals": expected
    }


async def test_put_replaces_the_previous_intervals(
    client: AsyncClient, pro: Member
) -> None:
    await put_hours(
        client, pro.token, pro.professional_id, interval(MONDAY, "09:00", "12:00")
    )
    replacement = interval(TUESDAY, "10:00", "11:00")

    await put_hours(client, pro.token, pro.professional_id, replacement)

    body = await get_hours(client, pro.token, pro.professional_id)
    assert body["intervals"] == [replacement]


async def test_empty_list_clears_the_working_hours(
    client: AsyncClient, pro: Member
) -> None:
    await put_hours(
        client, pro.token, pro.professional_id, interval(MONDAY, "09:00", "12:00")
    )

    response = await put_hours(client, pro.token, pro.professional_id)

    assert response.status_code == 200
    assert response.json()["intervals"] == []


async def test_touching_intervals_are_accepted_and_kept_separate(
    client: AsyncClient, pro: Member
) -> None:
    morning = interval(MONDAY, "09:00", "12:00")
    afternoon = interval(MONDAY, "12:00", "18:00")

    response = await put_hours(
        client, pro.token, pro.professional_id, morning, afternoon
    )

    assert response.status_code == 200
    assert response.json()["intervals"] == [morning, afternoon]


async def test_owner_can_set_the_hours_of_a_professional(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    hours = interval(MONDAY, "09:00", "12:00")

    response = await put_hours(client, owner_token, pro.professional_id, hours)

    assert response.status_code == 200
    body = await get_hours(client, pro.token, pro.professional_id)
    assert body["intervals"] == [hours]


@mark.parametrize(
    "intervals",
    [
        [interval(MONDAY, "09:00", "12:00"), interval(MONDAY, "11:59", "18:00")],
        [interval(MONDAY, "09:00", "18:00"), interval(MONDAY, "10:00", "11:00")],
        [interval(MONDAY, "09:00", "12:00"), interval(MONDAY, "09:00", "12:00")],
        [interval(MONDAY, "12:00", "09:00")],
        [interval(MONDAY, "09:00", "09:00")],
        [interval(-1, "09:00", "12:00")],
        [interval(7, "09:00", "12:00")],
        [interval(MONDAY, "09:00", "24:00")],
        [interval(MONDAY, "09:00:30", "12:00")],
        [interval(MONDAY, "09:00Z", "12:00")],
        [interval(MONDAY, "09:00-03:00", "12:00")],
        [interval(MONDAY, "abc", "12:00")],
        [{"weekday": MONDAY, "start_time": "09:00"}],
        [{**interval(MONDAY, "09:00", "12:00"), "extra": 1}],
    ],
)
async def test_invalid_intervals_are_refused_and_keep_the_previous_ones(
    client: AsyncClient, pro: Member, intervals: list[dict[str, Any]]
) -> None:
    previous = interval(TUESDAY, "10:00", "11:00")
    await put_hours(client, pro.token, pro.professional_id, previous)

    response = await put_hours(client, pro.token, pro.professional_id, *intervals)

    assert response.status_code == 422, response.text
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "VALIDATION_ERROR"
    body = await get_hours(client, pro.token, pro.professional_id)
    assert body["intervals"] == [previous]


@mark.parametrize(
    "body",
    [{}, {"intervals": None}, {"intervals": [], "business_id": "x"}],
)
async def test_invalid_body_is_refused(
    client: AsyncClient, pro: Member, body: dict[str, Any]
) -> None:
    response = await client.put(
        f"{API}/professionals/{pro.professional_id}/working-hours",
        json=body,
        headers=bearer(pro.token),
    )

    assert response.status_code == 422


async def test_ct25_appointments_left_outside_are_kept_and_listed(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
    colleague: Member,
) -> None:
    service = await create_service(client, owner_token)
    service_id = service["id"]
    now = clock.now

    # Before 12:00 and without preparation: stays inside.
    await make_appointment(
        db, pro.professional_id, service_id, next_local(now, MONDAY, "09:00")
    )
    # Ends exactly at the limit: stays inside.
    await make_appointment(
        db, pro.professional_id, service_id, next_local(now, MONDAY, "11:30")
    )
    # RN03: the preparation goes past 18:00, even though the service does not.
    preparation_outside = await make_appointment(
        db,
        pro.professional_id,
        service_id,
        next_local(now, MONDAY, "17:30"),
        preparation=10,
    )
    # Starts before the second interval.
    before_interval = await make_appointment(
        db, pro.professional_id, service_id, next_local(now, MONDAY, "12:30")
    )
    # A weekday without working hours.
    other_weekday = await make_appointment(
        db, pro.professional_id, service_id, next_local(now, TUESDAY, "10:00")
    )

    # None of these belongs in the answer.
    await make_appointment(db, pro.professional_id, service_id, now - timedelta(days=1))
    await make_appointment(
        db,
        pro.professional_id,
        service_id,
        next_local(now, TUESDAY, "11:00"),
        status=AppointmentStatus.CANCELLED,
    )
    await make_appointment(
        db, colleague.professional_id, service_id, next_local(now, TUESDAY, "10:00")
    )

    response = await put_hours(
        client,
        owner_token,
        pro.professional_id,
        interval(MONDAY, "09:00", "12:00"),
        interval(MONDAY, "13:00", "18:00"),
    )

    assert response.status_code == 200
    listed = response.json()["appointments_outside_hours"]
    expected = sorted(
        [preparation_outside, before_interval, other_weekday],
        key=lambda appointment: appointment.starts_at,
    )
    assert [item["id"] for item in listed] == [str(item.id) for item in expected]
    first = next(item for item in listed if item["id"] == str(preparation_outside.id))
    assert first == {
        "id": str(preparation_outside.id),
        "professional_id": pro.professional_id,
        "service_id": service_id,
        "starts_at": iso_utc(preparation_outside.starts_at),
        "ends_at": iso_utc(preparation_outside.ends_at),
        "blocked_until": iso_utc(preparation_outside.blocked_until),
        "status": "confirmed",
        "customer_name": "Cliente de Teste",
    }

    stored = await db.scalars(
        select(Appointment)
        .where(Appointment.id == preparation_outside.id)
        .execution_options(populate_existing=True)
    )
    kept = stored.one()
    assert kept.status is AppointmentStatus.CONFIRMED
    assert kept.starts_at == preparation_outside.starts_at


@mark.parametrize("status", [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])
async def test_ct25_future_appointment_with_a_final_status_is_not_listed(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
    status: AppointmentStatus,
) -> None:
    service = await create_service(client, owner_token)
    await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "10:00"),
        status=status,
    )
    confirmed = await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "11:00"),
    )

    # No working hours left, so only the status tells these two apart.
    response = await put_hours(client, owner_token, pro.professional_id)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["appointments_outside_hours"]] == [
        str(confirmed.id)
    ]


async def test_clearing_the_hours_lists_every_future_appointment(
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

    response = await put_hours(client, owner_token, pro.professional_id)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["appointments_outside_hours"]] == [
        str(appointment.id)
    ]


async def test_hours_follow_the_time_zone_of_the_business(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    await client.patch(
        f"{API}/business",
        json={"timezone": "Asia/Tokyo"},
        headers=bearer(owner_token),
    )
    # 22:00 on Monday in São Paulo is 10:00 on Tuesday in Tokyo.
    await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "22:00"),
    )

    response = await put_hours(
        client, owner_token, pro.professional_id, interval(TUESDAY, "09:00", "18:00")
    )

    assert response.status_code == 200
    assert response.json()["appointments_outside_hours"] == []
