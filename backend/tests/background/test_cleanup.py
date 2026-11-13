"""D115: the daily cleanup of the counters and of the finished e-mails.

It runs in the e-mail worker's loop, which every installation has, so it does
not depend on the demo restoration being on.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from pytest import LogCaptureFixture, MonkeyPatch, mark
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.email.fake import FakeSender
from app.jobs import email_worker
from app.jobs.cleanup import clean_up
from app.jobs.email_worker import serve
from app.jobs.in_process import background_tasks
from app.models import EmailOutbox, EmailOutboxStatus, RateLimitCounter
from tests.background.helpers import wait_until
from tests.email.helpers import get_message, make_message, worker_now

pytestmark = mark.anyio

SessionFactory = async_sessionmaker[AsyncSession]


async def add_counter(db: AsyncSession, key: str, window_start: datetime) -> None:
    await db.execute(
        insert(RateLimitCounter).values(key=key, window_start=window_start, count=1)
    )
    await db.commit()


async def counter_keys(db: AsyncSession) -> set[str]:
    return set(await db.scalars(select(RateLimitCounter.key)))


async def finished(
    db: AsyncSession, status: EmailOutboxStatus, created_at: datetime
) -> EmailOutbox:
    message = EmailOutbox(
        to_email=None,
        template="appointment_confirmation",
        payload=None,
        status=status,
        created_at=created_at,
        last_error="expired" if status is EmailOutboxStatus.FAILED else None,
    )
    db.add(message)
    await db.commit()
    return message


async def outbox_ids(db: AsyncSession) -> set[object]:
    return set(await db.scalars(select(EmailOutbox.id)))


async def old_rows(db: AsyncSession, now: datetime) -> dict[str, object]:
    """A row of each kind, on both sides of each cutoff."""
    await add_counter(db, "old", now - timedelta(days=2, seconds=1))
    await add_counter(db, "recent", now - timedelta(days=2) + timedelta(seconds=1))
    month = timedelta(days=30)
    return {
        "old_sent": (
            await finished(db, EmailOutboxStatus.SENT, now - month - timedelta(1))
        ).id,
        "old_failed": (
            await finished(db, EmailOutboxStatus.FAILED, now - month - timedelta(1))
        ).id,
        "recent_sent": (
            await finished(db, EmailOutboxStatus.SENT, now - month + timedelta(1))
        ).id,
        # Pending is never deleted, however old: it expires first (D39).
        "old_pending": (await make_message(db, created_at=now - month * 2)).id,
    }


async def test_deletes_only_what_ended_long_enough_ago(
    db: AsyncSession, session_factory: SessionFactory
) -> None:
    now = worker_now()
    ids = await old_rows(db, now)

    report = await clean_up(session_factory, now)

    assert (report.counters, report.emails) == (1, 2)
    assert await counter_keys(db) == {"recent"}
    assert await outbox_ids(db) == {ids["recent_sent"], ids["old_pending"]}


async def test_running_twice_deletes_nothing_more(
    db: AsyncSession, session_factory: SessionFactory
) -> None:
    now = worker_now()
    await old_rows(db, now)
    await clean_up(session_factory, now)

    report = await clean_up(session_factory, now)

    assert (report.counters, report.emails) == (0, 0)


async def test_the_log_holds_only_counts(
    db: AsyncSession, session_factory: SessionFactory, caplog: LogCaptureFixture
) -> None:
    now = worker_now()
    await old_rows(db, now)

    with caplog.at_level(logging.INFO, logger="app.jobs.cleanup"):
        await clean_up(session_factory, now)

    assert "cleanup deleted rate_limit_counters=1 email_outbox=2" in caplog.text


async def test_runs_with_the_restoration_off(
    db: AsyncSession,
    session_factory: SessionFactory,
    sender: FakeSender,
    settings: Settings,
) -> None:
    """A real installation: only the worker is on, and the cleanup still runs."""
    now = worker_now()
    ids = await old_rows(db, now)
    fresh = await make_message(db)
    on = settings.model_copy(update={"email_worker_in_process": True})
    assert on.demo_restore_in_process is False

    async with background_tasks(
        on, session_factory=session_factory, sender=sender, clock=worker_now
    ) as tasks:
        assert [task.get_name() for task in tasks] == ["email worker"]
        # The cleanup comes before the first cycle, which sends the fresh one
        # (and expires the old pending one, D39).
        await wait_until(lambda: len(sender.sent) == 1)

    assert await counter_keys(db) == {"recent"}
    assert await outbox_ids(db) == {ids["recent_sent"], ids["old_pending"], fresh.id}


async def test_runs_once_a_day(
    session_factory: SessionFactory, sender: FakeSender, monkeypatch: MonkeyPatch
) -> None:
    runs: list[datetime] = []

    async def counting(_: SessionFactory, now: datetime) -> None:
        runs.append(now)

    monkeypatch.setattr(email_worker, "clean_up", counting)
    start = worker_now()
    offsets = [timedelta(hours=hours) for hours in (0, 23, 24, 47)]
    stop = asyncio.Event()
    clock_calls = iter(offsets)

    def clock() -> datetime:
        try:
            return start + next(clock_calls)
        except StopIteration:
            stop.set()
            return start + offsets[-1]

    await asyncio.wait_for(
        serve(session_factory, sender, stop, clock=clock, interval=0), timeout=5
    )

    assert runs == [start, start + timedelta(hours=24)]


async def test_a_failed_cleanup_never_stops_the_sends(
    db: AsyncSession,
    session_factory: SessionFactory,
    sender: FakeSender,
    monkeypatch: MonkeyPatch,
    caplog: LogCaptureFixture,
) -> None:
    runs: list[datetime] = []

    async def broken(_: SessionFactory, now: datetime) -> None:
        runs.append(now)
        raise ConnectionResetError("db:5432 closed the connection")

    monkeypatch.setattr(email_worker, "clean_up", broken)
    message = await make_message(db)
    start = worker_now()
    stop = asyncio.Event()
    clock_calls = iter([timedelta(), timedelta(minutes=59), timedelta(hours=1)])

    def clock() -> datetime:
        try:
            return start + next(clock_calls)
        except StopIteration:
            stop.set()
            return start + timedelta(hours=1)

    await asyncio.wait_for(
        serve(session_factory, sender, stop, clock=clock, interval=0), timeout=5
    )

    assert (await get_message(db, message.id)).status is EmailOutboxStatus.SENT
    # Tried again an hour later, not a day later.
    assert runs == [start, start + timedelta(hours=1)]
    assert "cleanup failed: ConnectionResetError" in caplog.text
    assert "db:5432" not in caplog.text
