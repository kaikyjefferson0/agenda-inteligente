"""D105: the e-mail worker inside the API process, started by the lifespan."""

import asyncio
import logging
import time
from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from pytest import LogCaptureFixture, MonkeyPatch, mark
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.email.fake import FakeSender, SentEmail
from app.email.sender import EmailMessage
from app.jobs import in_process
from app.jobs.email_worker import BATCH_SIZE, run_once
from app.jobs.in_process import background_tasks, stop_tasks
from app.main import app, lifespan
from app.models import EmailOutboxStatus
from app.repositories import email_outbox
from tests.background.helpers import wait_until
from tests.demo.helpers import table_counts
from tests.email.helpers import get_message, make_message, worker_now

pytestmark = mark.anyio

SessionFactory = async_sessionmaker[AsyncSession]


def worker_on(settings: Settings) -> Settings:
    return settings.model_copy(update={"email_worker_in_process": True})


class StuckSender(FakeSender):
    """Holds every send until `release` is set, like a provider that hangs."""

    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        self.started.set()
        await self.release.wait()
        await super().send(message, idempotency_key)


class BuggySender(FakeSender):
    """Fails the first send with an error no adapter should raise."""

    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("adapter bug")
        self.sent.append(SentEmail(message, idempotency_key))


async def test_nothing_starts_with_both_variables_off(settings: Settings) -> None:
    async with background_tasks(settings) as tasks:
        assert tasks == []


async def test_the_api_lifespan_starts_nothing_by_default(
    settings: Settings, monkeypatch: MonkeyPatch, caplog: LogCaptureFixture
) -> None:
    monkeypatch.setattr("app.main.get_settings", lambda: settings)

    with caplog.at_level(logging.INFO, logger="app.jobs.in_process"):
        async with lifespan(app):
            pass

    assert "started in the API process" not in caplog.text


async def test_waking_up_with_messages_waiting(
    db: AsyncSession,
    session_factory: SessionFactory,
    sender: FakeSender,
    settings: Settings,
) -> None:
    """The API slept for hours: the queue is sent at once, in full batches."""
    now = worker_now()
    overdue = [
        await make_message(db, next_attempt_at=now - timedelta(hours=2))
        for _ in range(BATCH_SIZE + 2)
    ]
    expired = await make_message(db, created_at=now - timedelta(hours=25))
    later = await make_message(db, next_attempt_at=now + timedelta(minutes=10))
    # Reserved by the process that was put to sleep, and never written.
    reserved = await make_message(db)
    async with session_factory() as session:
        claimed = [
            m
            for m in await email_outbox.claim_due(session, now, 100)
            if m.id == reserved.id
        ]
        email_outbox.reserve(claimed[0], now - timedelta(minutes=1))
        await session.commit()

    started = time.monotonic()
    async with background_tasks(
        worker_on(settings),
        session_factory=session_factory,
        sender=sender,
        clock=worker_now,
        worker_interval=60,
    ):
        # 60 s between cycles: only the full batch followed at once gets here.
        await wait_until(lambda: len(sender.sent) == BATCH_SIZE + 3)

    assert time.monotonic() - started < 5
    for message in [*overdue, reserved]:
        assert (await get_message(db, message.id)).status is EmailOutboxStatus.SENT
    assert (await get_message(db, reserved.id)).attempts == 2
    stored = await get_message(db, expired.id)
    assert (stored.status, stored.last_error) == (EmailOutboxStatus.FAILED, "expired")
    # A retry for later waits for its time, as before the sleep.
    assert (await get_message(db, later.id)).status is EmailOutboxStatus.PENDING
    assert sender.attempts == BATCH_SIZE + 3


async def test_a_failed_send_keeps_the_worker_and_the_api_running(
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    client: AsyncClient,
) -> None:
    sender = BuggySender()
    failed = await make_message(db)
    sent = await make_message(db)

    async with background_tasks(
        worker_on(settings),
        session_factory=session_factory,
        sender=sender,
        clock=worker_now,
        worker_interval=60,
    ) as [task]:
        await wait_until(lambda: sender.attempts == 2)
        assert not task.done()
        assert (await client.get("/health")).status_code == 200

    retry = await get_message(db, failed.id)
    assert retry.status is EmailOutboxStatus.PENDING
    assert retry.last_error == "RuntimeError"
    assert (await get_message(db, sent.id)).status is EmailOutboxStatus.SENT


async def test_a_hanging_send_does_not_block_the_requests(
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    client: AsyncClient,
) -> None:
    sender = StuckSender()
    await make_message(db)

    async with background_tasks(
        worker_on(settings),
        session_factory=session_factory,
        sender=sender,
        clock=worker_now,
        shutdown_timeout=0.2,
    ):
        await asyncio.wait_for(sender.started.wait(), 5)
        response = await asyncio.wait_for(client.get("/health"), 1)
        assert response.status_code == 200
        sender.release.set()


async def test_shutdown_cancels_a_send_that_does_not_end_and_d38_recovers_it(
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    caplog: LogCaptureFixture,
) -> None:
    sender = StuckSender()
    message = await make_message(db)
    now = worker_now()

    started = time.monotonic()
    async with background_tasks(
        worker_on(settings),
        session_factory=session_factory,
        sender=sender,
        clock=lambda: now,
        shutdown_timeout=0.2,
    ) as [task]:
        await asyncio.wait_for(sender.started.wait(), 5)

    assert time.monotonic() - started < 3
    assert task.cancelled()
    assert "email worker did not stop in 0s; cancelling" in caplog.text
    # Reserved, never written: the next process sends it when the reservation ends.
    stored = await get_message(db, message.id)
    assert (stored.status, stored.attempts) == (EmailOutboxStatus.PENDING, 1)
    after = FakeSender()
    assert await run_once(session_factory, after, now + timedelta(minutes=4)) == 0
    assert await run_once(session_factory, after, now + timedelta(minutes=5)) == 1
    assert len(after.sent) == 1


async def test_shutdown_stops_both_tasks_between_cycles(
    session_factory: SessionFactory,
    sender: FakeSender,
    settings: Settings,
    hasher: Any,
    caplog: LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    both = settings.model_copy(
        update={"email_worker_in_process": True, "demo_restore_in_process": True}
    )
    async with background_tasks(
        both,
        session_factory=session_factory,
        sender=sender,
        worker_interval=60,
        restore_interval=600,
    ) as tasks:
        assert [task.get_name() for task in tasks] == ["email worker", "demo restore"]
        # Both are waiting for their next cycle.
        await wait_until(lambda: "demo restored in" in caplog.text)
        await asyncio.sleep(0.1)
        started = time.monotonic()

    # The stop event ends the waits at once, with nothing cancelled.
    assert time.monotonic() - started < 1
    assert all(task.done() and not task.cancelled() for task in tasks)
    assert "email worker started in the API process" in caplog.text
    assert "demo restore started in the API process" in caplog.text
    assert "background tasks stopped" in caplog.text
    assert "cancelling" not in caplog.text


async def test_a_task_that_dies_is_logged_and_the_other_goes_on(
    db: AsyncSession,
    session_factory: SessionFactory,
    settings: Settings,
    hasher: Any,
    monkeypatch: MonkeyPatch,
    caplog: LogCaptureFixture,
) -> None:
    async def dying(*_: Any, **__: Any) -> None:
        raise RuntimeError("bug")

    caplog.set_level(logging.INFO)
    monkeypatch.setattr(in_process, "serve", dying)
    both = settings.model_copy(
        update={"email_worker_in_process": True, "demo_restore_in_process": True}
    )

    async with background_tasks(
        both, session_factory=session_factory, sender=FakeSender()
    ) as [worker, restore]:
        await wait_until(worker.done)
        await wait_until(lambda: "demo restored in" in caplog.text)
        assert not restore.done()

    assert "email worker stopped: RuntimeError" in caplog.text
    assert (await table_counts(db))["businesses"] == 1


async def test_stop_tasks_with_nothing_to_stop() -> None:
    await stop_tasks([], timeout=1)
