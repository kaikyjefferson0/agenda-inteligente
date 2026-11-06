from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, AppointmentStatus, Professional
from tests.auth.helpers import API, Clock, bearer, invite
from tests.configuration.helpers import (
    MONDAY,
    Member,
    interval,
    make_appointment,
    next_local,
    put_hours,
)
from tests.public.helpers import (
    OTHER_SLUG,
    get_availability,
    link_services,
    local_day,
    local_iso,
    offered,
    page_path,
)

pytestmark = mark.anyio


async def test_availability_lists_the_free_times_with_the_local_offset(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await put_hours(
        client, owner_token, pro.professional_id, interval(MONDAY, "10:00", "11:00")
    )

    response = await get_availability(client, service["id"], local_day(monday_10))

    assert response.status_code == 200
    assert response.json() == {
        "date": local_day(monday_10),
        "slots": [
            {"starts_at": local_iso(monday_10)},
            {"starts_at": local_iso(monday_10 + timedelta(minutes=15))},
            {"starts_at": local_iso(monday_10 + timedelta(minutes=30))},
        ],
    }
    assert response.json()["slots"][0]["starts_at"].endswith("T10:00:00-03:00")


async def test_ct02_an_appointment_with_preparation_takes_the_time(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(
        db, pro.professional_id, service["id"], monday_10, minutes=30, preparation=15
    )

    slots = offered(await get_availability(client, service["id"], local_day(monday_10)))

    assert local_iso(monday_10) not in slots
    assert local_iso(monday_10 + timedelta(minutes=30)) not in slots
    assert local_iso(monday_10 + timedelta(minutes=45)) in slots


async def test_ct02_a_time_block_takes_the_time(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    created = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": monday_10.isoformat(),
            "ends_at": (monday_10 + timedelta(hours=1)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(owner_token),
    )
    assert created.status_code == 201

    slots = offered(await get_availability(client, service["id"], local_day(monday_10)))

    assert local_iso(monday_10) not in slots
    assert local_iso(monday_10 + timedelta(hours=1)) in slots


async def test_ct03_cancelled_appointment_offers_the_time_again(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], monday_10
    )
    day = local_day(monday_10)
    assert local_iso(monday_10) not in offered(
        await get_availability(client, service["id"], day)
    )

    # There is no cancellation route yet, so the status changes in the database.
    await db.execute(
        update(Appointment)
        .where(Appointment.id == appointment.id)
        .values(status=AppointmentStatus.CANCELLED)
    )
    await db.commit()

    assert local_iso(monday_10) in offered(
        await get_availability(client, service["id"], day)
    )


@mark.parametrize("status", [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])
async def test_final_statuses_keep_occupying_the_time(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    status: AppointmentStatus,
) -> None:
    await make_appointment(
        db, pro.professional_id, service["id"], monday_10, status=status
    )

    slots = offered(await get_availability(client, service["id"], local_day(monday_10)))

    assert local_iso(monday_10) not in slots


async def test_without_a_professional_gathers_everyone_eligible(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(db, pro.professional_id, service["id"], monday_10)
    day = local_day(monday_10)

    gathered = offered(await get_availability(client, service["id"], day))
    only_pro = offered(
        await get_availability(
            client, service["id"], day, professional_id=pro.professional_id
        )
    )
    only_colleague = offered(
        await get_availability(
            client, service["id"], day, professional_id=colleague.professional_id
        )
    )

    assert local_iso(monday_10) in gathered
    assert local_iso(monday_10) not in only_pro
    assert local_iso(monday_10) in only_colleague
    # Each time appears once, even when both are free.
    assert len(gathered) == len(set(gathered))
    assert gathered == sorted(gathered)


@mark.parametrize("days", [-30, 400], ids=["past", "too_far"])
async def test_ct04_day_outside_the_advance_window_is_an_empty_list(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    clock: Clock,
    days: int,
) -> None:
    day = (clock.now + timedelta(days=days)).date().isoformat()

    assert offered(await get_availability(client, service["id"], day)) == []


@mark.parametrize("day", ["0001-01-01", "9999-12-31"])
async def test_extreme_dates_are_an_empty_list(
    client: AsyncClient, service: dict[str, Any], pro: Member, day: str
) -> None:
    assert offered(await get_availability(client, service["id"], day)) == []


async def test_time_changes_follow_the_time_zone_of_the_business(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    clock: Clock,
) -> None:
    changed = await client.patch(
        f"{API}/business",
        json={"timezone": "America/New_York", "slot_step_minutes": 30},
        headers=bearer(owner_token),
    )
    assert changed.status_code == 200
    await put_hours(
        client, owner_token, pro.professional_id, interval(6, "01:00", "03:00")
    )
    clock.now = datetime(2030, 10, 25, tzinfo=UTC)

    response = await get_availability(client, service["id"], "2030-11-03")

    assert offered(response) == [
        "2030-11-03T01:00:00-04:00",
        "2030-11-03T01:30:00-04:00",
        "2030-11-03T02:00:00-05:00",
        "2030-11-03T02:30:00-05:00",
    ]


async def test_unknown_slug_answers_404(
    client: AsyncClient, service: dict[str, Any]
) -> None:
    response = await get_availability(
        client, service["id"], "2030-01-07", slug="nao-existe"
    )

    assert response.status_code == 404


async def test_unknown_service_answers_404(
    client: AsyncClient, owner_token: str
) -> None:
    response = await get_availability(client, str(uuid4()), "2030-01-07")

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


async def test_inactive_service_answers_404(
    client: AsyncClient, owner_token: str, service: dict[str, Any], pro: Member
) -> None:
    await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )

    response = await get_availability(client, service["id"], "2030-01-07")

    assert response.status_code == 404


async def test_unknown_professional_answers_404(
    client: AsyncClient, service: dict[str, Any], pro: Member
) -> None:
    response = await get_availability(
        client, service["id"], "2030-01-07", professional_id=str(uuid4())
    )

    assert response.status_code == 404


async def test_professional_who_does_not_serve_the_service_answers_422(
    client: AsyncClient, owner_token: str, service: dict[str, Any], pro: Member
) -> None:
    await link_services(client, owner_token, pro.professional_id)

    response = await get_availability(
        client, service["id"], "2030-01-07", professional_id=pro.professional_id
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["errors"][0]["loc"] == ["query", "professional_id"]


async def test_professional_who_is_not_bookable_answers_422(
    client: AsyncClient, db: AsyncSession, service: dict[str, Any], pro: Member
) -> None:
    await db.execute(update(Professional).values(is_bookable=False))
    await db.commit()

    response = await get_availability(
        client, service["id"], "2030-01-07", professional_id=pro.professional_id
    )

    assert response.status_code == 422


async def test_pending_invitation_gets_no_times(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    clock: Clock,
) -> None:
    invitation = await invite(client, owner_token, "novo@example.com")
    professional_id = invitation.json()["professional_id"]
    await link_services(client, owner_token, professional_id, service["id"])
    await put_hours(
        client, owner_token, professional_id, interval(MONDAY, "09:00", "18:00")
    )
    day = local_day(next_local(clock.now, MONDAY, "10:00"))

    assert offered(await get_availability(client, service["id"], day)) == []
    refused = await get_availability(
        client, service["id"], day, professional_id=professional_id
    )
    assert refused.status_code == 422


async def test_eligible_professional_without_working_hours_has_no_times(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await put_hours(client, owner_token, pro.professional_id)

    response = await get_availability(client, service["id"], local_day(monday_10))

    assert offered(response) == []


@mark.parametrize(
    "params",
    [
        {},
        {"service_id": "abc", "date": "2030-01-07"},
        {"date": "2030-01-07"},
        {"service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"},
        {"service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20", "date": "ontem"},
        {
            "service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
            "date": "2030-01-07",
            "professional_id": "abc",
        },
    ],
)
async def test_invalid_query_answers_422(
    client: AsyncClient, owner_token: str, params: dict[str, str]
) -> None:
    response = await client.get(f"{page_path()}/availability", params=params)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


async def test_service_of_another_business_answers_404(
    client: AsyncClient,
    service: dict[str, Any],
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    response = await get_availability(
        client, other_business["service_id"], local_day(monday_10)
    )

    assert response.status_code == 404


async def test_professional_of_another_business_answers_404(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    response = await get_availability(
        client,
        service["id"],
        local_day(monday_10),
        professional_id=other_business["professional_id"],
    )

    assert response.status_code == 404


async def test_appointments_of_another_business_do_not_take_the_time(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    await make_appointment(
        db,
        other_business["professional_id"],
        other_business["service_id"],
        monday_10,
    )
    day = local_day(monday_10)

    mine = offered(await get_availability(client, service["id"], day))
    theirs = offered(
        await get_availability(
            client, other_business["service_id"], day, slug=OTHER_SLUG
        )
    )

    assert local_iso(monday_10) in mine
    assert local_iso(monday_10) not in theirs
