"""RN29 and D42 to D49: the restoration job against the real database."""

import asyncio
import logging
from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from pydantic import SecretStr
from pytest import LogCaptureFixture, mark, raises
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import Settings
from app.email.templates import EmailTemplate
from app.models import (
    AppointmentOrigin,
    AppointmentStatus,
    Business,
    EmailOutbox,
    EmailOutboxStatus,
    User,
)
from app.services import demo_content as content
from app.services.demo_restore import DEMO_RESTORED_ERROR, DemoRestoreError
from tests.auth.helpers import Clock, register_owner
from tests.configuration.helpers import create_service, make_demo
from tests.demo.helpers import (
    DEMO_PASSWORD,
    OWNER_EMAIL,
    PROFESSIONAL_EMAIL,
    VOLATILE,
    business_rows,
    demo_appointments,
    local_today,
    next_working_day,
    outbox_rows,
    restore,
    table_counts,
)
from tests.email.helpers import make_message
from tests.public.helpers import (
    CUSTOMER_EMAIL,
    booking_body,
    get_availability,
    offered,
    post_booking,
)

pytestmark = mark.anyio


# CT29


async def test_ct29_creates_the_demo_with_current_dates(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
    hasher: Any,
) -> None:
    report = await restore(engine, settings, clock.now)

    business = await db.get(Business, content.BUSINESS_ID)
    assert business is not None
    assert (business.name, business.slug, business.timezone) == (
        "Barbearia Demo",
        "barbearia-demo",
        "America/Sao_Paulo",
    )
    assert business.is_demo is True
    # The model's defaults (D43).
    assert (
        business.slot_step_minutes,
        business.min_advance_minutes,
        business.max_advance_days,
        business.change_deadline_minutes,
    ) == (15, 60, 30, 120)

    appointments = await demo_appointments(db)
    today = local_today(clock.now)
    days = {local_today(item.starts_at) for item in appointments}
    assert min(days) >= today - timedelta(days=7)
    assert max(days) <= today + timedelta(days=6)
    past = {item.status for item in appointments if local_today(item.starts_at) < today}
    assert {
        AppointmentStatus.COMPLETED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.CANCELLED,
    } <= past
    future = [item for item in appointments if item.starts_at > clock.now]
    assert future
    for item in appointments:
        if item.customer_email is None:
            assert item.origin is AppointmentOrigin.STAFF
            assert item.access_token_hash is None
        else:
            assert item.customer_email.endswith("@example.com")
            assert item.access_token_hash is not None
        assert (item.status is AppointmentStatus.CANCELLED) == (
            item.cancelled_at is not None
        )
    assert report.created == {
        "businesses": 1,
        "users": 2,
        "professionals": 2,
        "services": 4,
        "professional_services": 6,
        "working_hours": 20,
        "time_blocks": 1,
        "appointments": len(appointments),
    }
    assert report.deleted == {}


async def test_ct29_another_day_moves_the_dates(
    engine: AsyncEngine, db: AsyncSession, settings: Settings, clock: Clock, hasher: Any
) -> None:
    await restore(engine, settings, clock.now)
    first = await demo_appointments(db)
    tomorrow = clock.now + timedelta(days=1)

    report = await restore(engine, settings, tomorrow)

    second = await demo_appointments(db)
    days = {local_today(item.starts_at) for item in second}
    assert min(days) >= local_today(tomorrow) - timedelta(days=7)
    assert max(days) <= local_today(tomorrow) + timedelta(days=6)
    # The ids come from the day and the position in it (D42): a day in both
    # windows keeps its appointments, only the status of today's ones moves on.
    before = {item.id: item.starts_at for item in first}
    kept = [item for item in second if item.id in before]
    assert kept and len(kept) < len(second)
    assert all(item.starts_at == before[item.id] for item in kept)
    assert report.deleted["appointments"] == len(first)
    assert report.deleted["businesses"] == 1


async def test_ct29_another_business_stays_intact(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
    other_business: dict[str, Any],
) -> None:
    await restore(engine, settings, clock.now)
    before = await business_rows(db, other_business["business_id"])
    outbox_before = await outbox_rows(db)
    assert before["appointments"] and before["refresh_tokens"]
    assert [row["status"] for row in outbox_before] == ["pending"]

    await restore(engine, settings, clock.now + timedelta(days=1))

    db.expire_all()
    assert await business_rows(db, other_business["business_id"]) == before
    assert await outbox_rows(db) == outbox_before


# CT63


async def test_ct63_restoring_twice_gives_the_same_rows_and_ids(
    engine: AsyncEngine, db: AsyncSession, settings: Settings, clock: Clock, hasher: Any
) -> None:
    first_report = await restore(engine, settings, clock.now)
    first = await business_rows(db, content.BUSINESS_ID, exclude=VOLATILE)

    second_report = await restore(engine, settings, clock.now + timedelta(minutes=5))

    db.expire_all()
    assert await business_rows(db, content.BUSINESS_ID, exclude=VOLATILE) == first
    assert second_report.created == first_report.created
    assert second_report.deleted == {
        **first_report.created,
        "account_tokens": 0,
        "refresh_tokens": 0,
    }
    ids = {row["id"] for row in first["users"]}
    assert ids == {content.OWNER.user_id, content.PROFESSIONAL.user_id}


async def test_ct63_a_demo_made_by_hand_is_replaced(
    client: AsyncClient,
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
) -> None:
    """D45: the demo of the old seed, with another id and slug, is deleted."""
    token = (await register_owner(client, "demo-antiga")).json()["access_token"]
    await create_service(client, token)
    await make_demo(db, "demo-antiga")

    report = await restore(engine, settings, clock.now)

    assert report.deleted["services"] == 1
    assert report.deleted["refresh_tokens"] == 1
    ids = await db.scalars(select(Business.id).where(Business.is_demo.is_(True)))
    assert list(ids) == [content.BUSINESS_ID]


# CT64


async def _refused(
    engine: AsyncEngine, db: AsyncSession, settings: Settings, clock: Clock
) -> None:
    counts = await table_counts(db)
    outbox = await outbox_rows(db)

    with raises(DemoRestoreError):
        await restore(engine, settings, clock.now)

    db.expire_all()
    assert await table_counts(db) == counts
    assert await outbox_rows(db) == outbox


async def test_ct64_slug_of_a_real_business(
    client: AsyncClient,
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
) -> None:
    await register_owner(client, "barbearia-demo", "dona@example.com")
    old_demo = await register_owner(client, "demo-antiga", "antiga@example.com")
    await create_service(client, old_demo.json()["access_token"])
    await make_demo(db, "demo-antiga")
    # A pending message to the demo, which D47 would have failed.
    await make_message(db, to_email=OWNER_EMAIL)

    await _refused(engine, db, settings, clock)

    real = await db.scalar(select(Business).where(Business.slug == "Barbearia-Demo"))
    assert real is not None and real.is_demo is False


async def test_ct64_demo_email_in_use_by_another_business(
    client: AsyncClient,
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
) -> None:
    await register_owner(client, "outro-negocio", PROFESSIONAL_EMAIL.upper())

    await _refused(engine, db, settings, clock)


async def test_ct64_demo_email_taken_after_the_demo_exists(
    client: AsyncClient,
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
) -> None:
    """The Dono's e-mail, freed in the demo, now belongs to a real business."""
    await restore(engine, settings, clock.now)
    await db.execute(
        update(User)
        .where(User.email == OWNER_EMAIL)
        .values(email=f"antigo@{content.STAFF_EMAIL_DOMAIN}")
    )
    await db.commit()
    await register_owner(client, "outro-negocio", OWNER_EMAIL)

    await _refused(engine, db, settings, clock)


async def test_ct64_more_than_one_demo_business(
    client: AsyncClient,
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
) -> None:
    await register_owner(client, "demo-um", "um@example.com")
    await register_owner(client, "demo-dois", "dois@example.com")
    await db.execute(update(Business).values(is_demo=True))
    await db.commit()

    await _refused(engine, db, settings, clock)


@mark.parametrize(
    "password",
    [None, "", "a" * 11, "a" * 129],
    ids=["missing", "empty", "11-characters", "129-characters"],
)
async def test_ct64_without_a_valid_demo_password_nothing_runs(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
    hasher: Any,
    password: str | None,
) -> None:
    await restore(engine, settings, clock.now)
    invalid = settings.model_copy(
        update={"demo_password": None if password is None else SecretStr(password)}
    )

    await _refused(engine, db, invalid, clock)


@mark.parametrize("length", [12, 128])
async def test_the_password_limits_are_accepted(
    engine: AsyncEngine,
    settings: Settings,
    clock: Clock,
    hasher: Any,
    length: int,
) -> None:
    valid = settings.model_copy(update={"demo_password": SecretStr("a" * length)})

    report = await restore(engine, valid, clock.now)

    assert report.created["users"] == 2


# CT66


async def test_ct66_two_simultaneous_restorations_leave_one_demo(
    engine: AsyncEngine, db: AsyncSession, settings: Settings, clock: Clock, hasher: Any
) -> None:
    first, second = await asyncio.gather(
        restore(engine, settings, clock.now), restore(engine, settings, clock.now)
    )

    # One created the demo; the other waited for the lock and replaced it.
    assert sorted([first.deleted, second.deleted], key=len)[0] == {}
    replaced = first.deleted or second.deleted
    assert replaced["appointments"] == first.created["appointments"]
    counts = await table_counts(db)
    assert counts["businesses"] == 1
    assert counts["appointments"] == first.created["appointments"]
    assert counts["users"] == 2


# CT67


async def test_ct67_pending_emails_of_the_demo_are_failed(
    client: AsyncClient,
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    clock: Clock,
    other_business: dict[str, Any],
) -> None:
    await restore(engine, settings, clock.now)
    staff = (
        await make_message(
            db,
            template=EmailTemplate.PASSWORD_RESET,
            to_email=PROFESSIONAL_EMAIL.upper(),
        )
    ).id
    seeded_customer = (await make_message(db, to_email=content.CUSTOMERS[0].email)).id
    # A visitor's booking on the demo, in the example domain.
    day = next_working_day(clock.now).isoformat()
    haircut = str(content.HAIRCUT.id)
    free = offered(await get_availability(client, haircut, day, slug=content.SLUG))
    booked = await post_booking(
        client,
        booking_body(haircut, free[0], email="Visitante@Example.com"),
        slug=content.SLUG,
    )
    assert booked.status_code == 201, booked.text
    already_sent = (await make_message(db, to_email=OWNER_EMAIL)).id
    await db.execute(
        update(EmailOutbox)
        .where(EmailOutbox.id == already_sent)
        .values(status=EmailOutboxStatus.SENT, payload=None)
    )
    await db.commit()
    # The other business's confirmation, from the fixture.
    [other_before] = [
        row for row in await outbox_rows(db) if row["to_email"] == CUSTOMER_EMAIL
    ]
    assert other_before["status"] == "pending"

    report = await restore(engine, settings, clock.now)

    assert report.failed_emails == 3
    db.expire_all()
    rows = {row["id"]: row for row in await outbox_rows(db)}
    [visitor] = [
        row
        for row in rows.values()
        if row["to_email"].lower() == "visitante@example.com"
    ]
    for row in (rows[staff], rows[seeded_customer], visitor):
        assert row["status"] == "failed"
        assert row["last_error"] == DEMO_RESTORED_ERROR
        assert row["payload"] is None
    assert rows[already_sent]["status"] == "sent"
    assert rows[already_sent]["last_error"] is None
    assert rows[other_before["id"]] == other_before


# D49


async def test_the_logs_hold_only_counts_and_the_duration(
    engine: AsyncEngine,
    settings: Settings,
    clock: Clock,
    hasher: Any,
    caplog: LogCaptureFixture,
) -> None:
    await restore(engine, settings, clock.now)

    with caplog.at_level(logging.INFO, logger="app.jobs.restore_demo"):
        await restore(engine, settings, clock.now)

    text = "\n".join(record.getMessage() for record in caplog.records)
    assert "demo deleted appointments=" in text
    assert "demo created businesses=1 users=2" in text
    assert text.count("businesses=1") == 2
    assert "email_outbox failed=0" in text
    assert "restored in" in text
    assert "@" not in text
    assert DEMO_PASSWORD not in text
    for name in (content.OWNER.name, content.CUSTOMERS[0].name, "Barbearia Demo"):
        assert name not in text
