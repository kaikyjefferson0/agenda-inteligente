import asyncio
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppointmentStatus, TimeBlock
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    BUSINESS_TIME_ZONE,
    MONDAY,
    Member,
    create_service,
    iso_utc,
    make_appointment,
    next_local,
)

pytestmark = mark.anyio


async def post_block(
    client: AsyncClient,
    token: str,
    professional_id: str,
    starts_at: datetime,
    ends_at: datetime,
    reason: str = "Folga",
) -> Response:
    return await client.post(
        f"{API}/professionals/{professional_id}/time-blocks",
        json={
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
            "reason": reason,
        },
        headers=bearer(token),
    )


async def list_blocks(client: AsyncClient, token: str, professional_id: str) -> Any:
    response = await client.get(
        f"{API}/professionals/{professional_id}/time-blocks", headers=bearer(token)
    )
    assert response.status_code == 200
    return response.json()


async def count_blocks(db: AsyncSession) -> int | None:
    return await db.scalar(select(func.count()).select_from(TimeBlock))


async def test_block_is_created_and_returned_in_utc(
    client: AsyncClient, clock: Clock, pro: Member
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    end = start + timedelta(hours=1)

    response = await post_block(
        client,
        pro.token,
        pro.professional_id,
        start.astimezone(BUSINESS_TIME_ZONE),
        end.astimezone(BUSINESS_TIME_ZONE),
        "  Consulta médica ",
    )

    assert response.status_code == 201
    body = response.json()
    assert body.pop("id")
    assert body == {
        "professional_id": pro.professional_id,
        "starts_at": iso_utc(start),
        "ends_at": iso_utc(end),
        "reason": "Consulta médica",
    }


async def test_list_is_ordered_and_only_of_that_professional(
    client: AsyncClient,
    clock: Clock,
    owner_token: str,
    pro: Member,
    colleague: Member,
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    hour = timedelta(hours=1)
    later = await post_block(
        client, pro.token, pro.professional_id, start + 2 * hour, start + 3 * hour
    )
    earlier = await post_block(
        client, owner_token, pro.professional_id, start, start + hour
    )
    await post_block(
        client, colleague.token, colleague.professional_id, start, start + hour
    )

    listed = await list_blocks(client, owner_token, pro.professional_id)

    assert [item["id"] for item in listed] == [
        earlier.json()["id"],
        later.json()["id"],
    ]


async def test_delete_removes_the_block_and_frees_the_time(
    client: AsyncClient, clock: Clock, pro: Member
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    end = start + timedelta(hours=1)
    block = await post_block(client, pro.token, pro.professional_id, start, end)
    path = f"{API}/time-blocks/{block.json()['id']}"

    deleted = await client.delete(path, headers=bearer(pro.token))
    repeated = await client.delete(path, headers=bearer(pro.token))
    recreated = await post_block(client, pro.token, pro.professional_id, start, end)

    assert deleted.status_code == 204
    assert repeated.status_code == 404
    assert recreated.status_code == 201


async def test_owner_can_delete_the_block_of_a_professional(
    client: AsyncClient, clock: Clock, owner_token: str, pro: Member
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    block = await post_block(
        client, pro.token, pro.professional_id, start, start + timedelta(hours=1)
    )

    response = await client.delete(
        f"{API}/time-blocks/{block.json()['id']}", headers=bearer(owner_token)
    )

    assert response.status_code == 204
    assert await list_blocks(client, pro.token, pro.professional_id) == []


async def test_block_in_the_past_is_accepted(
    client: AsyncClient, clock: Clock, pro: Member
) -> None:
    started_yesterday = await post_block(
        client,
        pro.token,
        pro.professional_id,
        clock.now - timedelta(days=1),
        clock.now + timedelta(days=1),
    )
    entirely_past = await post_block(
        client,
        pro.token,
        pro.professional_id,
        clock.now - timedelta(days=5),
        clock.now - timedelta(days=4),
    )

    assert started_yesterday.status_code == 201
    assert entirely_past.status_code == 201


@mark.parametrize(
    "changes",
    [
        {"starts_at": "2030-01-07T10:00:00"},
        {"ends_at": "2030-01-07T11:00:00"},
        {"starts_at": "abc"},
        {"starts_at": "2030-01-07T11:00:00Z"},
        {"starts_at": "2030-01-07T12:00:00Z"},
        {"starts_at": "0001-01-01T00:00:00+14:00"},
        {"reason": ""},
        {"reason": "   "},
        {"reason": "x" * 501},
        {"reason": None},
        {"business_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"},
    ],
)
async def test_invalid_blocks_are_refused(
    client: AsyncClient,
    db: AsyncSession,
    pro: Member,
    changes: dict[str, Any],
) -> None:
    valid = {
        "starts_at": "2030-01-07T10:00:00Z",
        "ends_at": "2030-01-07T11:00:00Z",
        "reason": "Folga",
    }

    response = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={**valid, **changes},
        headers=bearer(pro.token),
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert await count_blocks(db) == 0


async def test_ct17_block_over_a_confirmed_appointment_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    appointment = await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        starts_at,
        customer_email="cliente@example.com",
    )

    response = await post_block(
        client,
        pro.token,
        pro.professional_id,
        starts_at - timedelta(minutes=15),
        starts_at + timedelta(minutes=15),
    )

    assert response.status_code == 409
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["code"] == "APPOINTMENT_CONFLICTS"
    assert body["conflicts"] == [
        {
            "id": str(appointment.id),
            "professional_id": pro.professional_id,
            "service_id": service["id"],
            "starts_at": iso_utc(starts_at),
            "ends_at": iso_utc(appointment.ends_at),
            "blocked_until": iso_utc(appointment.blocked_until),
            "status": "confirmed",
            "customer_name": "Cliente de Teste",
        }
    ]
    assert "cliente@example.com" not in response.text
    assert await count_blocks(db) == 0


async def test_conflict_lists_every_appointment_in_the_period(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    first_start = next_local(clock.now, MONDAY, "10:00")
    second_start = next_local(clock.now, MONDAY, "11:00")
    first = await make_appointment(db, pro.professional_id, service["id"], first_start)
    second = await make_appointment(
        db, pro.professional_id, service["id"], second_start
    )

    response = await post_block(
        client,
        pro.token,
        pro.professional_id,
        first_start,
        second_start + timedelta(minutes=1),
    )

    assert [item["id"] for item in response.json()["conflicts"]] == [
        str(first.id),
        str(second.id),
    ]


async def test_ct17_preparation_time_counts_as_occupied(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    await make_appointment(
        db, pro.professional_id, service["id"], starts_at, minutes=30, preparation=10
    )

    # After the service ends (10:30), but during the preparation (until 10:40).
    during_preparation = await post_block(
        client,
        pro.token,
        pro.professional_id,
        starts_at + timedelta(minutes=35),
        starts_at + timedelta(minutes=60),
    )
    after_preparation = await post_block(
        client,
        pro.token,
        pro.professional_id,
        starts_at + timedelta(minutes=40),
        starts_at + timedelta(minutes=60),
    )

    assert during_preparation.status_code == 409
    assert after_preparation.status_code == 201


async def test_block_ending_when_the_appointment_starts_is_accepted(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    await make_appointment(db, pro.professional_id, service["id"], starts_at)

    response = await post_block(
        client,
        pro.token,
        pro.professional_id,
        starts_at - timedelta(hours=1),
        starts_at,
    )

    assert response.status_code == 201


@mark.parametrize(
    ("status", "expected"),
    [
        (AppointmentStatus.CANCELLED, 201),
        (AppointmentStatus.COMPLETED, 409),
        (AppointmentStatus.NO_SHOW, 409),
    ],
)
async def test_every_status_but_cancelled_occupies_the_time(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
    status: AppointmentStatus,
    expected: int,
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    await make_appointment(
        db, pro.professional_id, service["id"], starts_at, status=status
    )

    response = await post_block(
        client,
        pro.token,
        pro.professional_id,
        starts_at,
        starts_at + timedelta(minutes=30),
    )

    assert response.status_code == expected


async def test_appointment_of_a_colleague_is_not_a_conflict(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
    colleague: Member,
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    await make_appointment(db, colleague.professional_id, service["id"], starts_at)

    response = await post_block(
        client,
        pro.token,
        pro.professional_id,
        starts_at,
        starts_at + timedelta(minutes=30),
    )

    assert response.status_code == 201


async def test_block_over_another_block_is_refused(
    client: AsyncClient, db: AsyncSession, clock: Clock, pro: Member
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    hour = timedelta(hours=1)
    await post_block(client, pro.token, pro.professional_id, start, start + hour)

    overlapping = await post_block(
        client,
        pro.token,
        pro.professional_id,
        start + timedelta(minutes=59),
        start + 2 * hour,
    )
    touching = await post_block(
        client, pro.token, pro.professional_id, start + hour, start + 2 * hour
    )

    assert overlapping.status_code == 409
    assert overlapping.json()["code"] == "TIME_BLOCK_OVERLAP"
    assert "conflicts" not in overlapping.json()
    assert touching.status_code == 201
    assert await count_blocks(db) == 2


async def test_blocks_of_different_professionals_may_overlap(
    client: AsyncClient, clock: Clock, pro: Member, colleague: Member
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    end = start + timedelta(hours=1)

    first = await post_block(client, pro.token, pro.professional_id, start, end)
    second = await post_block(
        client, colleague.token, colleague.professional_id, start, end
    )

    assert first.status_code == 201
    assert second.status_code == 201


async def test_appointment_conflict_comes_before_block_overlap(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    start = next_local(clock.now, MONDAY, "10:00")
    hour = timedelta(hours=1)
    await post_block(client, pro.token, pro.professional_id, start, start + hour)
    await make_appointment(db, pro.professional_id, service["id"], start + hour)

    response = await post_block(
        client, pro.token, pro.professional_id, start, start + 2 * hour
    )

    assert response.status_code == 409
    assert response.json()["code"] == "APPOINTMENT_CONFLICTS"
    assert len(response.json()["conflicts"]) == 1


async def test_two_simultaneous_blocks_end_with_only_one(
    client: AsyncClient, db: AsyncSession, clock: Clock, pro: Member
) -> None:
    start = next_local(clock.now, MONDAY, "10:00")
    end = start + timedelta(hours=1)

    responses = await asyncio.gather(
        post_block(client, pro.token, pro.professional_id, start, end),
        post_block(client, pro.token, pro.professional_id, start, end),
    )

    assert sorted(item.status_code for item in responses) == [201, 409]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["code"] == "TIME_BLOCK_OVERLAP"
    assert await count_blocks(db) == 1
