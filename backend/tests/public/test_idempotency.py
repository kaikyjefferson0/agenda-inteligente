import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from httpx import AsyncClient
from pytest import MonkeyPatch, mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import hash_opaque_token
from app.repositories import appointments
from tests.auth.helpers import API, bearer
from tests.configuration.helpers import Member
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    OTHER_SLUG,
    booking_body,
    count_appointments,
    count_emails,
    get_appointment,
    link_token,
    page_path,
    post_booking,
)

pytestmark = mark.anyio


async def test_ct23_same_key_and_data_returns_the_same_appointment_without_the_link(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)

    created = await post_booking(client, body, key=key)
    repeated = await post_booking(client, body, key=key)

    assert created.status_code == 201
    assert created.json()["email_status"] == "queued"
    assert repeated.status_code == 200
    assert repeated.json() == {
        **created.json(),
        "access_url": None,
        "email_status": "unchanged",
    }
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1


async def test_a_repeat_does_not_change_the_link_nor_spend_email_quota(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.email_recipient_daily_cap = 1
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)

    created = await post_booking(client, body, key=key)
    await post_booking(client, body, key=key)
    # The quota of one was spent only by the creation, so this one has none left.
    other = await post_booking(
        client, booking_body(service["id"], monday_10 + timedelta(hours=1))
    )

    appointment = await get_appointment(db, created.json()["id"])
    assert appointment.access_token_hash == hash_opaque_token(link_token(created))
    assert other.json()["email_status"] == "skipped"


async def test_key_in_another_case_is_the_same_key(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)

    await post_booking(client, body, key=key)
    repeated = await post_booking(client, body, key=key.upper())

    assert repeated.status_code == 200
    assert await count_appointments(db) == 1


@mark.parametrize(
    "changes",
    [
        {"starts_at": 1},
        {"customer": {"name": "Outra Pessoa"}},
        {"customer": {"email": "outra@example.com"}},
        {"customer": {"email": CUSTOMER_EMAIL.upper()}},
        {"customer": {"phone": "+5511888888888"}},
        {"service_id": "other"},
        {"professional_id": "pro"},
    ],
    ids=[
        "time",
        "name",
        "email",
        "email_case",
        "phone",
        "unknown_service",
        "professional",
    ],
)
async def test_ct24_same_key_with_different_data_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    changes: dict[str, Any],
) -> None:
    key = str(uuid4())
    original = booking_body(service["id"], monday_10)
    await post_booking(client, original, key=key)

    different: dict[str, Any] = {**original, **changes}
    if "starts_at" in changes:
        different = booking_body(service["id"], monday_10 + timedelta(hours=1))
    if "customer" in changes:
        different["customer"] = {**original["customer"], **changes["customer"]}
    if "service_id" in changes:
        different["service_id"] = str(uuid4())
    if "professional_id" in changes:
        different["professional_id"] = pro.professional_id

    response = await post_booking(client, different, key=key)

    assert response.status_code == 409
    assert response.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1


async def test_ct24_the_same_instant_with_another_offset_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    await post_booking(client, booking_body(service["id"], monday_10), key=key)

    response = await post_booking(
        client, booking_body(service["id"], monday_10.isoformat()), key=key
    )

    assert response.status_code == 409
    assert response.json()["code"] == "IDEMPOTENCY_KEY_REUSED"


@mark.parametrize(
    "headers",
    [
        {},
        {"Idempotency-Key": ""},
        {"Idempotency-Key": "abc"},
        {"Idempotency-Key": "8f14e45fceea467fa9f71d2e3c4b5a69"},
        {"Idempotency-Key": "8f14e45f-ceea-467f-a9f7-1d2e3c4b5a6"},
        {"Idempotency-Key": "8f14e45f-ceea-467f-a9f7-1d2e3c4b5a69x"},
        {"Idempotency-Key": "g" * 8 + "-ceea-467f-a9f7-1d2e3c4b5a69"},
    ],
    ids=["missing", "empty", "short", "no_hyphens", "too_short", "too_long", "not_hex"],
)
async def test_key_that_is_missing_or_invalid_answers_422(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
    headers: dict[str, str],
) -> None:
    response = await client.post(
        f"{page_path()}/appointments",
        json=booking_body(service["id"], monday_10),
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert await count_appointments(db) == 0


async def test_a_refused_attempt_does_not_spend_the_key(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)
    block = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={
            "starts_at": monday_10.isoformat(),
            "ends_at": (monday_10 + timedelta(hours=1)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(owner_token),
    )
    refused = await post_booking(client, body, key=key)
    await client.delete(
        f"{API}/time-blocks/{block.json()['id']}", headers=bearer(owner_token)
    )

    accepted = await post_booking(client, body, key=key)

    assert refused.status_code == 409
    assert accepted.status_code == 201


async def test_a_repeat_works_after_the_service_is_deactivated(
    client: AsyncClient,
    owner_token: str,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)
    created = await post_booking(client, body, key=key)
    await client.patch(
        f"{API}/services/{service['id']}",
        json={"is_active": False},
        headers=bearer(owner_token),
    )

    repeated = await post_booking(client, body, key=key)

    assert repeated.status_code == 200
    assert repeated.json()["id"] == created.json()["id"]


async def test_the_same_key_in_another_business_is_a_new_booking(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    other_business: dict[str, Any],
    monday_10: datetime,
) -> None:
    key = str(uuid4())

    mine = await post_booking(client, booking_body(service["id"], monday_10), key=key)
    theirs = await post_booking(
        client,
        booking_body(other_business["service_id"], monday_10),
        key=key,
        slug=OTHER_SLUG,
    )

    assert mine.status_code == 201
    assert theirs.status_code == 201
    assert mine.json()["id"] != theirs.json()["id"]
    assert await count_appointments(db) == 2


async def test_ct27_recipient_limit_keeps_the_appointment_and_returns_the_link(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    responses = [
        await post_booking(
            client, booking_body(service["id"], monday_10 + timedelta(hours=hour))
        )
        for hour in range(4)
    ]

    # The limit is three a day per recipient.
    assert [item.json()["email_status"] for item in responses] == [
        "queued",
        "queued",
        "queued",
        "skipped",
    ]
    skipped = responses[-1]
    assert skipped.status_code == 201
    assert skipped.json()["access_url"]
    assert await count_appointments(db) == 4
    assert await count_emails(db) == 3
    appointment = await get_appointment(db, skipped.json()["id"])
    assert appointment.link_email_skipped is True
    assert appointment.access_token_hash == hash_opaque_token(link_token(skipped))


async def test_ct27_global_limit_keeps_the_appointment_and_returns_the_link(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.email_daily_cap = 0

    response = await post_booking(client, booking_body(service["id"], monday_10))

    assert response.status_code == 201
    assert response.json()["email_status"] == "skipped"
    assert response.json()["access_url"]
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 0


async def test_ct36_repeat_after_the_email_limit_replaces_the_link(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.email_recipient_daily_cap = 0
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)

    created = await post_booking(client, body, key=key)
    repeated = await post_booking(client, body, key=key)

    assert created.status_code == 201
    assert created.json()["email_status"] == "skipped"
    assert repeated.status_code == 200
    assert repeated.json()["id"] == created.json()["id"]
    assert repeated.json()["email_status"] == "skipped"
    new_token = link_token(repeated)
    old_token = link_token(created)
    assert new_token != old_token
    # The route of the link belongs to the next part. Here, the stored hash proves
    # that only the new token can be found.
    appointment = await get_appointment(db, created.json()["id"])
    assert appointment.access_token_hash == hash_opaque_token(new_token)
    assert appointment.access_token_hash != hash_opaque_token(old_token)
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 0


async def test_ct36_each_repeat_replaces_the_link_again_even_with_quota_back(
    client: AsyncClient,
    db: AsyncSession,
    settings: Settings,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    settings.email_recipient_daily_cap = 0
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)
    created = await post_booking(client, body, key=key)
    settings.email_recipient_daily_cap = 3

    first = await post_booking(client, body, key=key)
    second = await post_booking(client, body, key=key)

    assert first.json()["email_status"] == "skipped"
    assert link_token(first) != link_token(second)
    appointment = await get_appointment(db, created.json()["id"])
    assert appointment.access_token_hash == hash_opaque_token(link_token(second))
    assert await count_emails(db) == 0


async def test_two_simultaneous_requests_with_the_same_key_create_one_appointment(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)

    responses = await asyncio.gather(
        post_booking(client, body, key=key), post_booking(client, body, key=key)
    )

    assert sorted(item.status_code for item in responses) == [200, 201]
    created = next(item for item in responses if item.status_code == 201)
    repeated = next(item for item in responses if item.status_code == 200)
    assert repeated.json()["id"] == created.json()["id"]
    assert repeated.json()["access_url"] is None
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1


async def test_two_simultaneous_requests_with_the_same_key_and_different_data(
    client: AsyncClient,
    db: AsyncSession,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())

    # Different professionals, so nothing but the unique index separates them.
    responses = await asyncio.gather(
        post_booking(
            client,
            booking_body(service["id"], monday_10, professional_id=pro.professional_id),
            key=key,
        ),
        post_booking(
            client,
            booking_body(
                service["id"], monday_10, professional_id=colleague.professional_id
            ),
            key=key,
        ),
    )

    assert sorted(item.status_code for item in responses) == [201, 409]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1


def hide_key_from_the_first_lookups(
    monkeypatch: MonkeyPatch, hidden_lookups: int
) -> None:
    """Forces the race deterministically: the insert is what finds the key taken."""
    original: Callable[..., Awaitable[Any]] = appointments.get_by_idempotency_key
    calls = {"count": 0}

    async def lookup(*args: Any, **kwargs: Any) -> Any:
        calls["count"] += 1
        if calls["count"] <= hidden_lookups:
            return None
        return await original(*args, **kwargs)

    monkeypatch.setattr(appointments, "get_by_idempotency_key", lookup)


async def test_key_found_only_by_the_unique_index_returns_the_appointment(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    colleague: Member,
    monday_10: datetime,
) -> None:
    """The colleague is still free, so only the index stops a second appointment."""
    key = str(uuid4())
    body = booking_body(service["id"], monday_10)
    created = await post_booking(client, body, key=key)
    hide_key_from_the_first_lookups(monkeypatch, 2)

    repeated = await post_booking(client, body, key=key)

    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["id"] == created.json()["id"]
    assert repeated.json()["access_url"] is None
    assert repeated.json()["email_status"] == "unchanged"
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1


async def test_key_found_only_by_the_unique_index_with_different_data(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: MonkeyPatch,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    key = str(uuid4())
    await post_booking(client, booking_body(service["id"], monday_10), key=key)
    hide_key_from_the_first_lookups(monkeypatch, 2)

    response = await post_booking(
        client, booking_body(service["id"], monday_10 + timedelta(hours=1)), key=key
    )

    assert response.status_code == 409
    assert response.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert await count_appointments(db) == 1
    assert await count_emails(db) == 1
