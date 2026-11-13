"""D106: the daily restoration of the demo inside the API, with the lock of D45."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from httpx import AsyncClient
from pytest import LogCaptureFixture, MonkeyPatch, fixture, mark
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.security import hash_password
from app.jobs import in_process, restore_demo
from app.jobs.in_process import restore_and_clean_up, serve_demo_restore
from app.jobs.restore_demo import restore_demo_if_due
from app.models import Appointment, Business, RateLimitCounter
from app.repositories import demo
from app.services import demo_content as content
from app.services.demo_restore import rebuild
from tests.auth.helpers import Clock, register_owner
from tests.configuration.helpers import make_demo
from tests.demo.helpers import DEMO_PASSWORD, DEMO_ZONE, restore, table_counts
from tests.public.helpers import (
    booking_body,
    get_availability,
    offered,
    page_path,
    post_booking,
)

pytestmark = mark.anyio

SessionFactory = async_sessionmaker[AsyncSession]


def sao_paulo(day: datetime, hour: int, minute: int = 0) -> datetime:
    return day.astimezone(DEMO_ZONE).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )


@fixture
def today(clock: Clock) -> datetime:
    """Noon of today in São Paulo, past 03:00 whatever time the suite runs."""
    return sao_paulo(clock.now, 12)


@fixture
def yesterday(today: datetime) -> datetime:
    return today - timedelta(days=1)


async def restored_at(db: AsyncSession) -> datetime | None:
    db.expire_all()
    return await db.scalar(select(Business.created_at).where(Business.is_demo))


async def if_due(engine: AsyncEngine, settings: Settings, now: datetime) -> Any:
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        return await restore_demo_if_due(session, settings, now)


@fixture
def hashes(monkeypatch: MonkeyPatch) -> list[str]:
    """Counts the Argon2 hashes, the expensive part of a restoration."""
    calls: list[str] = []

    async def counting(password: str) -> str:
        calls.append(password)
        return await hash_password(password)

    monkeypatch.setattr(restore_demo, "hash_password", counting)
    return calls


async def test_creates_the_demo_when_there_is_none(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    today: datetime,
    hasher: Any,
) -> None:
    # Even before 03:00: no demo at all is never right.
    report = await if_due(engine, settings, sao_paulo(today, 1))

    assert report is not None
    assert report.created["businesses"] == 1
    # D106: the business keeps the clock of the restoration.
    assert await restored_at(db) == sao_paulo(today, 1)


async def test_a_demo_of_today_is_left_alone_without_hashing(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    today: datetime,
    hasher: Any,
    hashes: list[str],
) -> None:
    await restore(engine, settings, sao_paulo(today, 3, 30))
    hashes.clear()

    report = await if_due(engine, settings, sao_paulo(today, 23, 50))

    assert report is None
    assert hashes == []  # The cheap read decided it.
    assert await restored_at(db) == sao_paulo(today, 3, 30)


async def test_yesterdays_demo_waits_for_03_00(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    today: datetime,
    yesterday: datetime,
    hasher: Any,
) -> None:
    await restore(engine, settings, yesterday)

    assert await if_due(engine, settings, sao_paulo(today, 2, 59)) is None
    report = await if_due(engine, settings, sao_paulo(today, 3))

    assert report is not None
    assert report.deleted["businesses"] == 1
    assert await restored_at(db) == sao_paulo(today, 3)


async def test_two_processes_at_once_restore_only_once(
    engine: AsyncEngine,
    db: AsyncSession,
    settings: Settings,
    today: datetime,
    yesterday: datetime,
    hasher: Any,
    caplog: LogCaptureFixture,
) -> None:
    """D45: a deploy overlap, or a manual run, finds the check under the lock."""
    await restore(engine, settings, yesterday)
    caplog.set_level(logging.INFO)

    first, second = await asyncio.gather(
        if_due(engine, settings, today), if_due(engine, settings, today)
    )

    # Both read the old demo before the lock; the second gave up under it.
    assert [first is None, second is None].count(True) == 1
    assert "demo already restored today" in caplog.text
    assert caplog.text.count("demo restored in") == 1
    assert await restored_at(db) == today
    assert (await table_counts(db))["businesses"] == 1


async def test_a_refused_restoration_waits_for_the_next_check(
    client: AsyncClient,
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    today: datetime,
    yesterday: datetime,
    engine: AsyncEngine,
    caplog: LogCaptureFixture,
) -> None:
    await restore(engine, settings, yesterday)
    await register_owner(client, "outra-demo", "dona@example.com")
    await make_demo(db, "outra-demo")

    report = await restore_and_clean_up(session_factory, settings, today)

    assert report is None
    assert "demo restore refused: there is more than one demo business" in caplog.text
    assert (await table_counts(db))["businesses"] == 2


async def test_a_database_failure_waits_for_the_next_check(
    settings: Settings, today: datetime, caplog: LogCaptureFixture
) -> None:
    def broken_factory() -> Any:
        raise ConnectionRefusedError("database down at db:5432")

    report = await restore_and_clean_up(broken_factory, settings, today)  # type: ignore[arg-type]

    assert report is None
    assert "demo restore failed: ConnectionRefusedError" in caplog.text
    assert "db:5432" not in caplog.text


async def add_old_counter(db: AsyncSession, now: datetime) -> None:
    await db.execute(
        insert(RateLimitCounter).values(
            key="old", window_start=now - timedelta(days=3), count=1
        )
    )
    await db.commit()


async def test_the_cleanup_runs_after_a_restoration(
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    today: datetime,
    hasher: Any,
) -> None:
    await add_old_counter(db, today)

    report = await restore_and_clean_up(session_factory, settings, today)

    assert report is not None
    assert list(await db.scalars(select(RateLimitCounter.key))) == []


async def test_a_failed_cleanup_never_undoes_the_restoration(
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    today: datetime,
    yesterday: datetime,
    engine: AsyncEngine,
    hasher: Any,
    monkeypatch: MonkeyPatch,
    caplog: LogCaptureFixture,
) -> None:
    await restore(engine, settings, yesterday)

    async def broken(*_: Any) -> None:
        raise ConnectionResetError("lost the connection")

    monkeypatch.setattr(in_process, "clean_up", broken)

    report = await restore_and_clean_up(session_factory, settings, today)

    assert report is not None
    assert await restored_at(db) == today  # Committed before the cleanup.
    assert "cleanup failed: ConnectionResetError" in caplog.text


async def test_checks_at_once_and_then_every_interval(
    session_factory: SessionFactory,
    settings: Settings,
    today: datetime,
    monkeypatch: MonkeyPatch,
) -> None:
    checks: list[datetime] = []
    stop = asyncio.Event()

    async def counting(_: SessionFactory, __: Settings, now: datetime) -> None:
        checks.append(now)
        if len(checks) == 3:
            stop.set()

    monkeypatch.setattr(in_process, "restore_and_clean_up", counting)

    await asyncio.wait_for(
        serve_demo_restore(
            session_factory, settings, stop, clock=lambda: today, interval=0
        ),
        timeout=5,
    )

    assert checks == [today, today, today]


async def test_requests_during_a_restoration(
    engine: AsyncEngine,
    db: AsyncSession,
    client: AsyncClient,
    settings: Settings,
    clock: Clock,
    hasher: Any,
) -> None:
    """Reads never wait; a write waits for the commit and finds the new demo."""
    await restore(engine, settings, clock.now)
    haircut = str(content.HAIRCUT.id)
    owner = str(content.OWNER.professional_id)
    day = (clock.now.astimezone(DEMO_ZONE).date() + timedelta(days=1)).isoformat()
    free = offered(
        await get_availability(
            client, haircut, day, professional_id=owner, slug=content.SLUG
        )
    )
    hashes = {
        account.user_id: await hash_password(DEMO_PASSWORD)
        for account in content.ACCOUNTS
    }

    async with async_sessionmaker(engine, expire_on_commit=False)() as restoring:
        await demo.lock_restoration(restoring, content.RESTORE_LOCK_KEY)
        await rebuild(restoring, hashes, clock.now)
        # Uncommitted: the page is the old demo, and it answers at once.
        page = await asyncio.wait_for(client.get(page_path(content.SLUG)), 2)
        assert page.status_code == 200, page.text
        booking = asyncio.create_task(
            post_booking(
                client,
                booking_body(haircut, free[0], professional_id=owner),
                slug=content.SLUG,
            )
        )
        await asyncio.sleep(0.5)
        assert not booking.done()  # Waiting for the restoration's locks.
        await restoring.commit()

    response = await asyncio.wait_for(booking, 5)
    # Same day, same plan: the time is free in the new demo too. On another day
    # it could be taken, and the answer would be 409 SLOT_UNAVAILABLE.
    assert response.status_code == 201, response.text
    booked = await db.scalar(
        select(Appointment.business_id).where(
            Appointment.id == UUID(response.json()["id"])
        )
    )
    assert booked == content.BUSINESS_ID
