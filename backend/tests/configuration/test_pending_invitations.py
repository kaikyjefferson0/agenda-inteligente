"""D95 and D96: when a pending invite expires, and cancelling it (UC04, RN24)."""

import asyncio
from datetime import timedelta
from typing import Any
from uuid import UUID

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountToken,
    EmailOutbox,
    Professional,
    ProfessionalService,
    TimeBlock,
    User,
    WorkingHours,
)
from tests.auth.helpers import (
    API,
    Clock,
    accept,
    bearer,
    invite,
    last_link_token,
    login,
    outbox_for,
)
from tests.configuration.helpers import (
    MONDAY,
    Member,
    create_service,
    interval,
    iso_utc,
    make_demo,
    next_local,
    put_hours,
    start_serving,
)

pytestmark = mark.anyio

PENDING_EMAIL = "pendente@example.com"
MISSING_ID = "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"


async def cancel(client: AsyncClient, token: str, professional_id: str) -> Response:
    return await client.delete(
        f"{API}/professionals/{professional_id}/invitation", headers=bearer(token)
    )


async def deactivate(client: AsyncClient, token: str, professional_id: str) -> Response:
    return await client.post(
        f"{API}/professionals/{professional_id}/deactivate", headers=bearer(token)
    )


async def invite_pending(
    client: AsyncClient, token: str, email: str = PENDING_EMAIL
) -> dict[str, Any]:
    response = await invite(client, token, email)
    assert response.status_code == 202, response.text
    return response.json()


async def listed(client: AsyncClient, token: str) -> dict[str, dict[str, Any]]:
    response = await client.get(f"{API}/professionals", headers=bearer(token))
    assert response.status_code == 200
    return {item["email"]: item for item in response.json()}


async def find_user(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(
        select(User)
        .where(User.email == email)
        .execution_options(populate_existing=True)
    )


async def count(db: AsyncSession, model: Any, **filters: Any) -> int:
    query = select(func.count()).select_from(model)
    for name, value in filters.items():
        query = query.where(getattr(model, name) == value)
    return await db.scalar(query) or 0


def assert_refused(response: Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == code


# D95: when the invite expires, in GET /professionals


async def test_pending_invite_tells_when_its_link_expires(
    client: AsyncClient, clock: Clock, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)

    item = (await listed(client, owner_token))[PENDING_EMAIL]

    assert item["invitation_pending"] is True
    assert item["invitation_expires_at"] == invitation["expires_at"]
    assert item["invitation_expires_at"] == iso_utc(clock.now + timedelta(days=7))
    assert "token" not in str(item)


async def test_renewing_the_invite_moves_the_date(
    client: AsyncClient, clock: Clock, owner_token: str
) -> None:
    await invite_pending(client, owner_token)
    clock.advance(timedelta(days=2))

    renewed = await invite_pending(client, owner_token)

    item = (await listed(client, owner_token))[PENDING_EMAIL]
    assert item["invitation_expires_at"] == renewed["expires_at"]
    assert item["invitation_expires_at"] == iso_utc(clock.now + timedelta(days=7))


async def test_expired_invite_is_still_pending_with_a_date_in_the_past(
    client: AsyncClient, clock: Clock, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    clock.advance(timedelta(days=8))

    item = (await listed(client, owner_token))[PENDING_EMAIL]

    assert item["invitation_pending"] is True
    assert item["invitation_expires_at"] == invitation["expires_at"]


async def test_accepted_invite_and_owner_have_no_date(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    await start_serving(client, owner_token)

    items = await listed(client, owner_token)

    assert items[pro.email]["invitation_pending"] is False
    assert items[pro.email]["invitation_expires_at"] is None
    owner = next(item for email, item in items.items() if email != pro.email)
    assert owner["invitation_pending"] is False
    assert owner["invitation_expires_at"] is None


async def test_professional_sees_the_field_in_the_own_record(
    client: AsyncClient, pro: Member
) -> None:
    [item] = (await listed(client, pro.token)).values()

    assert item["invitation_expires_at"] is None


async def test_deactivated_before_accepting_is_no_longer_pending(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    """D96: pending means it can still be accepted, without looking at is_active."""
    invitation = await invite_pending(client, owner_token)
    link_token = await last_link_token(db, PENDING_EMAIL)
    professional_id = invitation["professional_id"]
    assert (await deactivate(client, owner_token, professional_id)).status_code == 204

    item = (await listed(client, owner_token))[PENDING_EMAIL]
    accepted = await accept(client, link_token)
    cancelled = await cancel(client, owner_token, professional_id)

    assert item["is_active"] is False
    assert item["invitation_pending"] is False
    assert item["invitation_expires_at"] is None
    assert_refused(accepted, 400, "INVALID_TOKEN")
    assert_refused(cancelled, 409, "INVITATION_NOT_PENDING")
    assert await find_user(db, PENDING_EMAIL) is not None


async def test_other_responses_with_the_professional_bring_the_date(
    client: AsyncClient, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    service = await create_service(client, owner_token)

    response = await client.put(
        f"{API}/professionals/{invitation['professional_id']}/services",
        json={"service_ids": [service["id"]]},
        headers=bearer(owner_token),
    )

    assert response.status_code == 200
    assert response.json()["invitation_expires_at"] == invitation["expires_at"]
    assert (await start_serving(client, owner_token))["invitation_expires_at"] is None


# D96: cancelling a pending invite


async def test_owner_cancels_a_pending_invite_and_everything_of_it_goes(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    professional_id = invitation["professional_id"]
    # The Owner can configure a pending professional before the accept.
    service = await create_service(client, owner_token)
    await client.put(
        f"{API}/professionals/{professional_id}/services",
        json={"service_ids": [service["id"]]},
        headers=bearer(owner_token),
    )
    hours = await put_hours(
        client, owner_token, professional_id, interval(MONDAY, "09:00", "12:00")
    )
    assert hours.status_code == 200
    starts_at = next_local(clock.now, MONDAY, "10:00")
    block = await client.post(
        f"{API}/professionals/{professional_id}/time-blocks",
        json={
            "starts_at": starts_at.isoformat(),
            "ends_at": (starts_at + timedelta(hours=1)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(owner_token),
    )
    assert block.status_code == 201
    user = await find_user(db, PENDING_EMAIL)
    assert user is not None

    response = await cancel(client, owner_token, professional_id)

    assert response.status_code == 204
    assert response.content == b""
    assert await find_user(db, PENDING_EMAIL) is None
    pid = UUID(professional_id)
    assert await count(db, Professional, id=pid) == 0
    assert await count(db, ProfessionalService, professional_id=pid) == 0
    assert await count(db, WorkingHours, professional_id=pid) == 0
    assert await count(db, TimeBlock, professional_id=pid) == 0
    assert await count(db, AccountToken, user_id=user.id) == 0
    assert PENDING_EMAIL not in await listed(client, owner_token)
    # The service itself belongs to the business and stays.
    services = await client.get(f"{API}/services", headers=bearer(owner_token))
    assert [item["id"] for item in services.json()] == [service["id"]]


async def test_link_of_a_cancelled_invite_is_refused(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    link_token = await last_link_token(db, PENDING_EMAIL)
    assert (await cancel(client, owner_token, invitation["professional_id"])).is_success

    accepted = await accept(client, link_token)

    assert_refused(accepted, 400, "INVALID_TOKEN")
    assert (await login(client, PENDING_EMAIL)).status_code == 401


async def test_the_email_can_be_invited_again_after_cancelling(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    first = await invite_pending(client, owner_token)
    old_link = await last_link_token(db, PENDING_EMAIL)
    assert (await cancel(client, owner_token, first["professional_id"])).is_success

    again = await invite_pending(client, owner_token)
    new_link = await last_link_token(db, PENDING_EMAIL)

    assert again["professional_id"] != first["professional_id"]
    assert new_link != old_link
    assert (await accept(client, old_link)).status_code == 400
    assert (await accept(client, new_link)).status_code == 204
    assert (await login(client, PENDING_EMAIL)).status_code == 200


async def test_another_business_can_invite_the_freed_email(
    client: AsyncClient, owner_token: str, other_owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    taken = await invite(client, other_owner_token, PENDING_EMAIL)
    assert_refused(taken, 409, "EMAIL_IN_USE")

    assert (await cancel(client, owner_token, invitation["professional_id"])).is_success

    assert (await invite(client, other_owner_token, PENDING_EMAIL)).status_code == 202


async def test_expired_invite_can_be_cancelled(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    clock.advance(timedelta(days=8))

    response = await cancel(client, owner_token, invitation["professional_id"])

    assert response.status_code == 204
    assert await find_user(db, PENDING_EMAIL) is None


async def test_queued_invite_email_never_goes_out(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    await invite_pending(client, owner_token)  # A renewal: two queued e-mails.
    await invite_pending(client, owner_token, "outra@example.com")

    assert (await cancel(client, owner_token, invitation["professional_id"])).is_success

    cancelled = await outbox_for(db, PENDING_EMAIL)
    assert [message.status for message in cancelled] == ["failed", "failed"]
    assert {message.last_error for message in cancelled} == {"invitation_cancelled"}
    assert all(message.payload is None for message in cancelled)
    [other] = await outbox_for(db, "outra@example.com")
    assert other.status == "pending"
    assert other.payload is not None


async def test_cancelling_leaves_other_emails_to_the_address_alone(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    db.add(
        EmailOutbox(
            to_email=PENDING_EMAIL.upper(),
            template="appointment_confirmation",
            payload={"url": "https://app.test/agendamento/x"},
        )
    )
    await db.commit()

    assert (await cancel(client, owner_token, invitation["professional_id"])).is_success

    statuses = {
        message.template: message.status
        for message in await db.scalars(
            select(EmailOutbox).execution_options(populate_existing=True)
        )
    }
    assert statuses == {
        "account_invite": "failed",
        "appointment_confirmation": "pending",
    }


async def test_professional_cannot_cancel_an_invite(
    client: AsyncClient, db: AsyncSession, owner_token: str, pro: Member
) -> None:
    invitation = await invite_pending(client, owner_token)

    response = await cancel(client, pro.token, invitation["professional_id"])

    assert_refused(response, 403, "FORBIDDEN")
    assert await find_user(db, PENDING_EMAIL) is not None


async def test_demo_refuses_to_cancel(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    """RN28: invites are off in the demo, and so is cancelling one."""
    invitation = await invite_pending(client, owner_token)
    await make_demo(db)

    response = await cancel(client, owner_token, invitation["professional_id"])
    missing = await cancel(client, owner_token, MISSING_ID)

    assert_refused(response, 403, "DEMO_RESTRICTED")
    assert_refused(missing, 403, "DEMO_RESTRICTED")
    assert await find_user(db, PENDING_EMAIL) is not None
    [message] = await outbox_for(db, PENDING_EMAIL)
    assert message.status == "pending"


async def test_accepted_invite_cannot_be_cancelled(
    client: AsyncClient, db: AsyncSession, owner_token: str, pro: Member
) -> None:
    response = await cancel(client, owner_token, pro.professional_id)

    assert_refused(response, 409, "INVITATION_NOT_PENDING")
    assert (await login(client, pro.email)).status_code == 200


async def test_deactivated_professional_cannot_be_cancelled(
    client: AsyncClient, db: AsyncSession, owner_token: str, pro: Member
) -> None:
    assert (await deactivate(client, owner_token, pro.professional_id)).is_success

    response = await cancel(client, owner_token, pro.professional_id)

    assert_refused(response, 409, "INVITATION_NOT_PENDING")
    assert await find_user(db, pro.email) is not None


async def test_owner_record_cannot_be_cancelled(
    client: AsyncClient, owner_token: str
) -> None:
    created = await start_serving(client, owner_token)

    response = await cancel(client, owner_token, created["id"])

    assert_refused(response, 409, "INVITATION_NOT_PENDING")


async def test_invite_of_another_business_is_not_found(
    client: AsyncClient, db: AsyncSession, owner_token: str, other_owner_token: str
) -> None:
    invitation = await invite_pending(client, other_owner_token)

    response = await cancel(client, owner_token, invitation["professional_id"])
    missing = await cancel(client, owner_token, MISSING_ID)

    assert_refused(response, 404, "NOT_FOUND")
    assert_refused(missing, 404, "NOT_FOUND")
    assert await find_user(db, PENDING_EMAIL) is not None


async def test_cancelling_requires_authentication_and_a_valid_id(
    client: AsyncClient, owner_token: str
) -> None:
    anonymous = await client.delete(f"{API}/professionals/{MISSING_ID}/invitation")
    invalid = await cancel(client, owner_token, "nao-e-um-uuid")

    assert_refused(anonymous, 401, "NOT_AUTHENTICATED")
    assert_refused(invalid, 422, "VALIDATION_ERROR")


async def test_cancel_and_accept_at_the_same_time_have_a_single_winner(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    invitation = await invite_pending(client, owner_token)
    link_token = await last_link_token(db, PENDING_EMAIL)

    cancelled, accepted = await asyncio.gather(
        cancel(client, owner_token, invitation["professional_id"]),
        accept(client, link_token),
    )

    user = await find_user(db, PENDING_EMAIL)
    if cancelled.status_code == 204:
        assert accepted.status_code == 400
        assert user is None
    else:
        assert_refused(cancelled, 409, "INVITATION_NOT_PENDING")
        assert accepted.status_code == 204
        assert user is not None
        assert user.password_hash is not None
