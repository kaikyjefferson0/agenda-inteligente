from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import generate_opaque_token
from tests.auth.helpers import Clock
from tests.configuration.helpers import Member
from tests.public.helpers import (
    book,
    booking_body,
    cancel_link,
    count_appointments,
    count_emails,
    get_availability,
    get_link,
    link_path,
    local_day,
    page_path,
    post_booking,
)

pytestmark = mark.anyio

BOOKINGS_PER_HOUR = 10
READS_PER_MINUTE = 120
TRUSTED_HEADER = "X-Test-Client-Ip"


def assert_limited(response: Response) -> None:
    assert response.status_code == 429, response.text
    assert response.json()["code"] == "RATE_LIMITED"
    assert int(response.headers["Retry-After"]) > 0


async def book_up_to_the_limit(
    client: AsyncClient, service_id: str, starts_at: datetime
) -> None:
    for index in range(BOOKINGS_PER_HOUR):
        response = await post_booking(
            client,
            booking_body(
                service_id,
                starts_at + timedelta(minutes=30 * index),
                email=f"cliente{index}@example.com",
            ),
        )
        assert response.status_code == 201, response.text


async def test_ct22_excess_bookings_answer_429_without_new_emails(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await book_up_to_the_limit(client, service["id"], monday_10)

    response = await post_booking(
        client,
        booking_body(
            service["id"], monday_10 + timedelta(hours=6), email="extra@example.com"
        ),
    )

    assert_limited(response)
    assert await count_appointments(db) == BOOKINGS_PER_HOUR
    assert await count_emails(db) == BOOKINGS_PER_HOUR


async def test_booking_limit_starts_again_in_the_next_window(
    client: AsyncClient,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    await book_up_to_the_limit(client, service["id"], monday_10)
    clock.advance(timedelta(hours=1))

    response = await post_booking(
        client,
        booking_body(
            service["id"], monday_10 + timedelta(hours=6), email="extra@example.com"
        ),
    )

    assert response.status_code == 201


async def test_repeats_also_count_against_the_booking_limit(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)
    for _ in range(BOOKINGS_PER_HOUR):
        await post_booking(client, body, key=key)

    assert_limited(await post_booking(client, body, key=key))


async def test_invalid_requests_and_unknown_slugs_also_count(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    valid = booking_body(service["id"], monday_10)
    for index in range(BOOKINGS_PER_HOUR):
        if index % 2:
            response = await post_booking(client, valid, slug="nao-existe")
            assert response.status_code == 404
        else:
            response = await post_booking(client, {**valid, "starts_at": "ontem"})
            assert response.status_code == 422

    assert_limited(await post_booking(client, valid))


async def test_malformed_json_is_refused_before_it_can_count(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """FastAPI parses the body before any dependency, without touching the database."""
    for _ in range(BOOKINGS_PER_HOUR):
        response = await client.post(
            f"{page_path()}/appointments",
            content=b"{nao e json",
            headers={
                "Idempotency-Key": str(uuid4()),
                "Content-Type": "application/json",
            },
        )
        assert response.status_code == 422

    response = await post_booking(client, booking_body(service["id"], monday_10))
    assert response.status_code == 201


async def test_booking_limit_is_per_ip(
    client: AsyncClient,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.trusted_client_ip_header = TRUSTED_HEADER
    body = booking_body(service["id"], monday_10)
    path = f"{page_path()}/appointments"

    async def post(client_ip: str) -> Response:
        return await client.post(
            path,
            json={**body, "starts_at": "ontem"},
            headers={"Idempotency-Key": str(uuid4()), TRUSTED_HEADER: client_ip},
        )

    for _ in range(BOOKINGS_PER_HOUR):
        assert (await post("203.0.113.1")).status_code == 422

    assert_limited(await post("203.0.113.1"))
    assert (await post("203.0.113.2")).status_code == 422


async def test_excess_availability_requests_answer_429(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    day = local_day(monday_10)
    for _ in range(READS_PER_MINUTE):
        response = await get_availability(client, service["id"], day)
        assert response.status_code == 200

    assert_limited(await get_availability(client, service["id"], day))


async def test_excess_page_requests_answer_429(
    client: AsyncClient, owner_token: str
) -> None:
    for _ in range(READS_PER_MINUTE):
        assert (await client.get(page_path())).status_code == 200

    assert_limited(await client.get(page_path()))


async def test_each_public_route_has_its_own_counter(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    for _ in range(READS_PER_MINUTE):
        await client.get(page_path())

    assert_limited(await client.get(page_path()))
    response = await get_availability(client, service["id"], local_day(monday_10))
    assert response.status_code == 200


LINK_REQUESTS_PER_MINUTE = 60


async def test_link_routes_share_one_counter_that_counts_invalid_requests(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """D22: the three routes, invalid tokens and invalid bodies, in one counter."""
    _, token = await book(client, service["id"], monday_10)
    for index in range(LINK_REQUESTS_PER_MINUTE):
        kind = index % 3
        if kind == 0:
            response = await get_link(client, generate_opaque_token())
            assert response.status_code == 404
        elif kind == 1:
            response = await client.post(f"{link_path(token)}/reschedule", json={})
            assert response.status_code == 422
        else:
            response = await get_link(client, token)
            assert response.status_code == 200

    response = await cancel_link(client, token)

    assert_limited(response)
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert await count_emails(db, "appointment_cancellation") == 0


async def test_link_limit_starts_again_in_the_next_minute(
    client: AsyncClient,
    clock: Clock,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)
    for _ in range(LINK_REQUESTS_PER_MINUTE):
        await get_link(client, token)
    assert_limited(await get_link(client, token))

    clock.advance(timedelta(minutes=1))

    assert (await get_link(client, token)).status_code == 200


async def test_link_counter_is_apart_from_the_business_page(
    client: AsyncClient,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    _, token = await book(client, service["id"], monday_10)
    for _ in range(LINK_REQUESTS_PER_MINUTE + 1):
        await get_link(client, token)

    assert (await client.get(page_path())).status_code == 200
