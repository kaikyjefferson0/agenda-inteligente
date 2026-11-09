"""UC15: the agenda of the team (D25, D26)."""

from datetime import datetime, timedelta, timezone
from typing import Any

from httpx import AsyncClient
from pytest import mark
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppointmentStatus, Service
from tests.appointments.helpers import AGENDA, AGENDA_FIELDS, get_agenda
from tests.auth.helpers import bearer
from tests.configuration.helpers import Member, iso_utc, make_appointment
from tests.public.helpers import book

pytestmark = mark.anyio

DAY = timedelta(days=1)
MAX_PERIOD = timedelta(hours=31 * 24)
MINUS_THREE = timezone(timedelta(hours=-3))


def ids(response: Any) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()]


async def test_d26_the_agenda_shows_the_copied_values_and_no_secrets(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    booked, _ = await book(
        client, service["id"], monday_10, professional_id=pro.professional_id
    )
    # RN11: the name is the current one, and the values are the copied ones.
    await db.execute(
        update(Service).values(name="Corte novo", price_cents=9900, duration_minutes=60)
    )
    await db.commit()

    response = await get_agenda(client, owner_token, monday_10, monday_10 + DAY)

    assert response.status_code == 200, response.text
    [item] = response.json()
    assert set(item) == AGENDA_FIELDS
    assert item == {
        "id": booked.json()["id"],
        "professional_id": pro.professional_id,
        "service_id": service["id"],
        "service_name": "Corte novo",
        "starts_at": iso_utc(monday_10),
        "ends_at": iso_utc(monday_10 + timedelta(minutes=30)),
        "blocked_until": iso_utc(monday_10 + timedelta(minutes=30)),
        "duration_minutes": 30,
        "preparation_minutes": 0,
        "price_cents": 5000,
        "status": "confirmed",
        "origin": "public",
        "customer_name": "Cliente de Exemplo",
        "customer_email": "cliente@example.com",
        "customer_phone": "+5511999999999",
        "cancelled_at": None,
    }


async def test_ct51_the_agenda_brings_every_status_ordered_by_the_start(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    later = await make_appointment(
        db, pro.professional_id, service["id"], monday_10 + timedelta(hours=2)
    )
    cancelled = await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        monday_10,
        status=AppointmentStatus.CANCELLED,
    )
    same_time = [
        await make_appointment(db, pro.professional_id, service["id"], monday_10),
        await make_appointment(db, colleague.professional_id, service["id"], monday_10),
    ]
    done = await make_appointment(
        db,
        colleague.professional_id,
        service["id"],
        monday_10 + timedelta(hours=1),
        status=AppointmentStatus.COMPLETED,
    )
    missed = await make_appointment(
        db,
        colleague.professional_id,
        service["id"],
        monday_10 + timedelta(hours=3),
        status=AppointmentStatus.NO_SHOW,
    )

    response = await get_agenda(client, owner_token, monday_10, monday_10 + DAY)

    # Same start: the id breaks the tie.
    first_three = sorted([cancelled, *same_time], key=lambda row: str(row.id))
    expected = [*first_three, done, later, missed]
    assert ids(response) == [str(row.id) for row in expected]
    statuses = {item["id"]: item["status"] for item in response.json()}
    assert statuses[str(cancelled.id)] == "cancelled"
    assert statuses[str(done.id)] == "completed"
    assert statuses[str(missed.id)] == "no_show"


async def test_d25_the_period_is_half_open_on_the_start(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """In the agenda, an appointment counts by the start, never by the end."""
    at_start = await make_appointment(db, pro.professional_id, service["id"], monday_10)
    at_end = await make_appointment(
        db, pro.professional_id, service["id"], monday_10 + timedelta(hours=1)
    )

    assert ids(
        await get_agenda(client, owner_token, monday_10, monday_10 + timedelta(hours=1))
    ) == [str(at_start.id)]
    # Started before `from`, so it stays out even while still running.
    assert ids(
        await get_agenda(
            client,
            owner_token,
            monday_10 + timedelta(minutes=10),
            monday_10 + timedelta(hours=2),
        )
    ) == [str(at_end.id)]


async def test_ct51_to_must_be_after_from(
    client: AsyncClient, owner_token: str, monday_10: datetime
) -> None:
    for ends_at in (monday_10, monday_10 - timedelta(minutes=1)):
        response = await get_agenda(client, owner_token, monday_10, ends_at)

        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"
        assert response.json()["errors"][0]["loc"] == ["query", "to"]


async def test_ct51_the_period_goes_up_to_exactly_31_days(
    client: AsyncClient, owner_token: str, monday_10: datetime
) -> None:
    exact = await get_agenda(client, owner_token, monday_10, monday_10 + MAX_PERIOD)
    above = await get_agenda(
        client, owner_token, monday_10, monday_10 + MAX_PERIOD + timedelta(seconds=1)
    )

    assert exact.status_code == 200, exact.text
    assert exact.json() == []
    assert above.status_code == 422
    assert above.json()["code"] == "VALIDATION_ERROR"


async def test_d25_from_and_to_are_required_and_need_an_offset(
    client: AsyncClient, owner_token: str
) -> None:
    missing = await client.get(
        AGENDA, params={"from": "2030-03-04T00:00:00Z"}, headers=bearer(owner_token)
    )
    naive = await get_agenda(
        client, owner_token, "2030-03-04T00:00:00", "2030-03-05T00:00:00"
    )
    malformed = await get_agenda(client, owner_token, "ontem", "hoje")

    for response in (missing, naive, malformed):
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"


async def test_d25_any_offset_is_accepted_and_the_answer_is_in_utc(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    appointment = await make_appointment(
        db, pro.professional_id, service["id"], monday_10
    )
    local_from = (monday_10 - timedelta(hours=1)).astimezone(MINUS_THREE)

    response = await get_agenda(
        client,
        owner_token,
        local_from.isoformat(),
        (monday_10 + timedelta(hours=1)).isoformat(),
    )

    assert ids(response) == [str(appointment.id)]
    assert response.json()[0]["starts_at"] == iso_utc(monday_10)


async def test_d25_the_professional_sees_only_the_own_agenda_by_default(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    mine = await make_appointment(db, pro.professional_id, service["id"], monday_10)
    theirs = await make_appointment(
        db, colleague.professional_id, service["id"], monday_10
    )
    period = (monday_10, monday_10 + DAY)

    own_default = await get_agenda(client, pro.token, *period)
    own_explicit = await get_agenda(
        client, pro.token, *period, professional_id=pro.professional_id
    )
    owner_all = await get_agenda(client, owner_token, *period)
    owner_one = await get_agenda(
        client, owner_token, *period, professional_id=colleague.professional_id
    )

    assert ids(own_default) == [str(mine.id)]
    assert ids(own_explicit) == [str(mine.id)]
    assert set(ids(owner_all)) == {str(mine.id), str(theirs.id)}
    assert ids(owner_one) == [str(theirs.id)]


async def test_ct20_the_professional_cannot_see_the_agenda_of_a_colleague(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    await make_appointment(db, colleague.professional_id, service["id"], monday_10)

    response = await get_agenda(
        client,
        pro.token,
        monday_10,
        monday_10 + DAY,
        professional_id=colleague.professional_id,
    )

    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


async def test_ct19_the_agenda_of_another_business_is_not_found(
    client: AsyncClient,
    db: AsyncSession,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    await make_appointment(db, pro.professional_id, service["id"], monday_10)

    response = await get_agenda(
        client,
        owner_token,
        monday_10,
        monday_10 + DAY,
        professional_id=other_business["professional_id"],
    )
    everything = await get_agenda(
        client, other_business["token"], monday_10, monday_10 + DAY
    )

    assert response.status_code == 404
    assert everything.status_code == 200
    assert everything.json() == []


async def test_the_agenda_requires_a_session(
    client: AsyncClient, monday_10: datetime
) -> None:
    response = await client.get(
        AGENDA,
        params={"from": iso_utc(monday_10), "to": iso_utc(monday_10 + DAY)},
    )

    assert response.status_code == 401
