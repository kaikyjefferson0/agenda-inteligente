import asyncio
from datetime import timedelta
from uuid import UUID

from httpx import AsyncClient, Response
from pytest import mark
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountToken,
    AccountTokenPurpose,
    Appointment,
    AppointmentStatus,
    Professional,
    ProfessionalService,
)
from tests.auth.helpers import (
    API,
    OWNER_EMAIL,
    Clock,
    accept,
    bearer,
    family_of,
    get_user,
    invite,
    last_link_token,
    login,
    post_refresh,
    raw_refresh_token,
)
from tests.configuration.helpers import (
    MONDAY,
    Member,
    create_service,
    make_appointment,
    next_local,
    start_serving,
)

pytestmark = mark.anyio

MISSING_ID = "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20"


async def deactivate(client: AsyncClient, token: str, professional_id: str) -> Response:
    return await client.post(
        f"{API}/professionals/{professional_id}/deactivate", headers=bearer(token)
    )


async def set_services(
    client: AsyncClient, token: str, professional_id: str, *service_ids: str
) -> Response:
    return await client.put(
        f"{API}/professionals/{professional_id}/services",
        json={"service_ids": list(service_ids)},
        headers=bearer(token),
    )


async def get_professional(db: AsyncSession, professional_id: str) -> Professional:
    professional = await db.get(
        Professional, UUID(professional_id), populate_existing=True
    )
    assert professional is not None
    return professional


async def list_professionals(client: AsyncClient, token: str) -> list[dict]:
    response = await client.get(f"{API}/professionals", headers=bearer(token))
    assert response.status_code == 200
    return response.json()


# Owner flow


async def test_owner_starts_serving(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    response = await client.post(f"{API}/professionals/me", headers=bearer(owner_token))

    assert response.status_code == 201
    body = response.json()
    owner = await get_user(db, OWNER_EMAIL)
    assert body["user_id"] == str(owner.id)
    assert body["email"] == OWNER_EMAIL
    assert body["is_bookable"] is True
    assert body["is_active"] is True
    assert body["invitation_pending"] is False
    assert body["service_ids"] == []


async def test_repeating_the_call_keeps_the_same_record(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    first = await client.post(f"{API}/professionals/me", headers=bearer(owner_token))
    second = await client.post(f"{API}/professionals/me", headers=bearer(owner_token))

    assert second.status_code == 200
    assert second.json() == first.json()
    count = await db.scalar(select(func.count()).select_from(Professional))
    assert count == 1


async def test_owner_who_stopped_serving_comes_back_with_the_same_record(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    created = await start_serving(client, owner_token)
    await deactivate(client, owner_token, created["id"])

    response = await client.post(f"{API}/professionals/me", headers=bearer(owner_token))

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]
    assert response.json()["is_bookable"] is True


async def test_two_simultaneous_calls_create_one_record(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    responses = await asyncio.gather(
        *(
            client.post(f"{API}/professionals/me", headers=bearer(owner_token))
            for _ in range(2)
        )
    )

    assert sorted(item.status_code for item in responses) == [200, 201]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    count = await db.scalar(select(func.count()).select_from(Professional))
    assert count == 1


# Listing


async def test_owner_who_does_not_serve_and_has_no_team_sees_an_empty_list(
    client: AsyncClient, owner_token: str
) -> None:
    assert await list_professionals(client, owner_token) == []


async def test_owner_sees_everyone_including_pending_and_deactivated(
    client: AsyncClient, owner_token: str, pro: Member, colleague: Member
) -> None:
    await invite(client, owner_token, "pendente@example.com")
    await deactivate(client, owner_token, colleague.professional_id)

    listed = {
        item["email"]: item for item in await list_professionals(client, owner_token)
    }

    assert set(listed) == {pro.email, colleague.email, "pendente@example.com"}
    assert listed[pro.email]["is_active"] is True
    assert listed[pro.email]["is_bookable"] is True
    assert listed[colleague.email]["is_active"] is False
    assert listed[colleague.email]["is_bookable"] is False
    assert listed["pendente@example.com"]["invitation_pending"] is True
    assert listed["pendente@example.com"]["is_bookable"] is False
    assert "password_hash" not in str(listed)


async def test_professional_sees_only_the_own_record(
    client: AsyncClient, pro: Member, colleague: Member
) -> None:
    listed = await list_professionals(client, pro.token)

    assert [item["id"] for item in listed] == [pro.professional_id]


# CT18 and deactivation


async def test_ct18_deactivation_is_refused_until_appointments_are_resolved(
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
        customer_email="cliente@example.com",
    )

    refused = await deactivate(client, owner_token, pro.professional_id)

    assert refused.status_code == 409
    assert refused.headers["content-type"] == "application/problem+json"
    body = refused.json()
    assert body["code"] == "APPOINTMENT_CONFLICTS"
    assert [item["id"] for item in body["conflicts"]] == [str(appointment.id)]
    assert set(body["conflicts"][0]) == {
        "id",
        "professional_id",
        "service_id",
        "starts_at",
        "ends_at",
        "blocked_until",
        "status",
        "customer_name",
    }
    assert "cliente@example.com" not in refused.text
    assert (await get_professional(db, pro.professional_id)).is_bookable is True
    assert (await get_user(db, pro.email)).is_active is True

    appointment.status = AppointmentStatus.CANCELLED
    appointment.cancelled_at = clock.now
    await db.commit()

    accepted = await deactivate(client, owner_token, pro.professional_id)

    assert accepted.status_code == 204
    assert (await get_professional(db, pro.professional_id)).is_bookable is False
    assert (await get_user(db, pro.email)).is_active is False


async def test_only_future_confirmed_appointments_prevent_deactivation(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    service_id = service["id"]
    await make_appointment(
        db, pro.professional_id, service_id, clock.now - timedelta(days=1)
    )
    # Already in progress, and starting exactly now is not in the future either.
    await make_appointment(
        db,
        pro.professional_id,
        service_id,
        clock.now - timedelta(minutes=10),
        minutes=10,
    )
    await make_appointment(db, pro.professional_id, service_id, clock.now)
    await make_appointment(
        db,
        pro.professional_id,
        service_id,
        clock.now + timedelta(days=1),
        status=AppointmentStatus.CANCELLED,
    )

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 204


@mark.parametrize("status", [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])
async def test_ct18_future_appointment_with_a_final_status_does_not_prevent_it(
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

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 204, response.text


async def test_appointment_one_second_ahead_prevents_deactivation(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    await make_appointment(
        db, pro.professional_id, service["id"], clock.now + timedelta(seconds=1)
    )

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 409


async def test_appointments_of_a_colleague_do_not_prevent_deactivation(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
    colleague: Member,
) -> None:
    service = await create_service(client, owner_token)
    await make_appointment(
        db,
        colleague.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "10:00"),
    )

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 204


async def test_deactivated_professional_loses_access_immediately(
    client: AsyncClient, db: AsyncSession, owner_token: str, pro: Member
) -> None:
    refresh_token = raw_refresh_token(pro.login_response)

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 204
    assert response.content == b""
    me = await client.get(f"{API}/auth/me", headers=bearer(pro.token))
    assert me.status_code == 401
    assert (await login(client, pro.email)).status_code == 401
    assert (await post_refresh(client, refresh_token)).status_code == 401


async def test_deactivation_revokes_every_session_and_unused_link(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    # `is_active = false` already refuses these at the routes, so a leftover active
    # token would only show up here, in the stored state.
    second_session = (await login(client, pro.email)).json()["access_token"]
    forgot = await client.post(f"{API}/auth/password/forgot", json={"email": pro.email})
    assert forgot.status_code == 202

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 204
    for access_token in (pro.token, second_session):
        tokens = await family_of(db, access_token)
        assert tokens
        assert all(token.revoked_at == clock.now for token in tokens)
    user = await get_user(db, pro.email)
    reset_link = await db.scalar(
        select(AccountToken)
        .where(
            AccountToken.user_id == user.id,
            AccountToken.purpose == AccountTokenPurpose.PASSWORD_RESET,
        )
        .execution_options(populate_existing=True)
    )
    assert reset_link is not None
    assert reset_link.used_at == clock.now


async def test_deactivated_email_stays_in_use(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    await deactivate(client, owner_token, pro.professional_id)

    response = await invite(client, owner_token, pro.email)

    assert response.status_code == 409
    assert response.json()["code"] == "EMAIL_IN_USE"


async def test_deactivating_a_pending_invitation_invalidates_the_link(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    email = "pendente@example.com"
    invitation = await invite(client, owner_token, email)
    link_token = await last_link_token(db, email)

    response = await deactivate(
        client, owner_token, invitation.json()["professional_id"]
    )

    assert response.status_code == 204
    accepted = await accept(client, link_token)
    assert accepted.status_code == 400
    assert accepted.json()["code"] == "INVALID_TOKEN"


async def test_owner_who_stops_serving_keeps_the_login(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    created = await start_serving(client, owner_token)

    response = await deactivate(client, owner_token, created["id"])

    assert response.status_code == 204
    assert (await get_professional(db, created["id"])).is_bookable is False
    assert (await get_user(db, OWNER_EMAIL)).is_active is True
    me = await client.get(f"{API}/auth/me", headers=bearer(owner_token))
    assert me.status_code == 200
    assert (await login(client, OWNER_EMAIL)).status_code == 200


async def test_owner_with_future_appointments_cannot_stop_serving(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str
) -> None:
    created = await start_serving(client, owner_token)
    service = await create_service(client, owner_token)
    await make_appointment(
        db, created["id"], service["id"], next_local(clock.now, MONDAY, "10:00")
    )

    response = await deactivate(client, owner_token, created["id"])

    assert response.status_code == 409
    assert response.json()["code"] == "APPOINTMENT_CONFLICTS"


async def test_repeating_the_deactivation_is_accepted(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    await deactivate(client, owner_token, pro.professional_id)

    response = await deactivate(client, owner_token, pro.professional_id)

    assert response.status_code == 204


async def test_deactivation_and_acceptance_at_the_same_time_end_without_access(
    client: AsyncClient, db: AsyncSession, owner_token: str
) -> None:
    email = "corrida@example.com"
    invitation = await invite(client, owner_token, email)
    link_token = await last_link_token(db, email)

    deactivated, accepted = await asyncio.gather(
        deactivate(client, owner_token, invitation.json()["professional_id"]),
        accept(client, link_token),
    )

    assert deactivated.status_code == 204
    assert accepted.status_code in (204, 400)
    assert (await get_user(db, email)).is_active is False
    professional = await get_professional(db, invitation.json()["professional_id"])
    assert professional.is_bookable is False


# UC07


async def test_put_replaces_the_previous_services(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    first = await create_service(client, owner_token, name="Corte")
    second = await create_service(client, owner_token, name="Barba")
    await set_services(client, owner_token, pro.professional_id, first["id"])

    response = await set_services(
        client, owner_token, pro.professional_id, second["id"]
    )

    assert response.status_code == 200
    assert response.json()["id"] == pro.professional_id
    assert response.json()["service_ids"] == [second["id"]]
    listed = await list_professionals(client, pro.token)
    assert listed[0]["service_ids"] == [second["id"]]


async def test_empty_list_removes_all_services(
    client: AsyncClient, db: AsyncSession, owner_token: str, pro: Member
) -> None:
    service = await create_service(client, owner_token)
    await set_services(client, owner_token, pro.professional_id, service["id"])

    response = await set_services(client, owner_token, pro.professional_id)

    assert response.status_code == 200
    assert response.json()["service_ids"] == []
    count = await db.scalar(select(func.count()).select_from(ProfessionalService))
    assert count == 0


async def test_repeated_services_are_kept_once(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    service = await create_service(client, owner_token)

    response = await set_services(
        client, owner_token, pro.professional_id, service["id"], service["id"]
    )

    assert response.status_code == 200
    assert response.json()["service_ids"] == [service["id"]]


async def test_inactive_service_is_accepted_and_the_link_survives_deactivation(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    linked = await create_service(client, owner_token, name="Corte")
    inactive = await create_service(client, owner_token, name="Barba")
    await set_services(client, owner_token, pro.professional_id, linked["id"])
    for service in (linked, inactive):
        await client.patch(
            f"{API}/services/{service['id']}",
            json={"is_active": False},
            headers=bearer(owner_token),
        )

    listed = await list_professionals(client, pro.token)
    response = await set_services(
        client, owner_token, pro.professional_id, inactive["id"]
    )

    assert listed[0]["service_ids"] == [linked["id"]]
    assert response.status_code == 200
    assert response.json()["service_ids"] == [inactive["id"]]


async def test_pending_professional_can_already_be_configured(
    client: AsyncClient, owner_token: str
) -> None:
    invitation = await invite(client, owner_token, "pendente@example.com")
    service = await create_service(client, owner_token)

    response = await set_services(
        client, owner_token, invitation.json()["professional_id"], service["id"]
    )

    assert response.status_code == 200
    assert response.json()["is_bookable"] is False


async def test_changing_services_does_not_change_appointments(
    client: AsyncClient,
    db: AsyncSession,
    clock: Clock,
    owner_token: str,
    pro: Member,
) -> None:
    service = await create_service(client, owner_token)
    await set_services(client, owner_token, pro.professional_id, service["id"])
    appointment = await make_appointment(
        db,
        pro.professional_id,
        service["id"],
        next_local(clock.now, MONDAY, "10:00"),
    )

    await set_services(client, owner_token, pro.professional_id)

    kept = await db.get(Appointment, appointment.id, populate_existing=True)
    assert kept is not None
    assert kept.status is AppointmentStatus.CONFIRMED


async def test_missing_service_is_refused_and_changes_nothing(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    service = await create_service(client, owner_token)
    await set_services(client, owner_token, pro.professional_id, service["id"])

    response = await set_services(
        client, owner_token, pro.professional_id, service["id"], MISSING_ID
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    listed = await list_professionals(client, pro.token)
    assert listed[0]["service_ids"] == [service["id"]]


async def test_invalid_service_ids_are_refused(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    response = await set_services(client, owner_token, pro.professional_id, "abc")

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


async def test_simultaneous_replacements_do_not_collide(
    client: AsyncClient, owner_token: str, pro: Member
) -> None:
    service = await create_service(client, owner_token)

    responses = await asyncio.gather(
        *(
            set_services(client, owner_token, pro.professional_id, service["id"])
            for _ in range(3)
        )
    )

    assert [item.status_code for item in responses] == [200, 200, 200]
