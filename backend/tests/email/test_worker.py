"""D38 to D40: one cycle of the worker, with the fake sender and a set clock."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, cast

import httpx
from pytest import LogCaptureFixture, mark
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.email_retry import MAX_ATTEMPTS, RETRY_DELAYS, FailureKind
from app.email.fake import FakeSender
from app.email.resend import ResendSender
from app.email.sender import EmailMessage
from app.email.templates import EmailTemplate
from app.jobs.email_worker import BATCH_SIZE, run_once, serve
from app.models import EmailOutboxStatus
from app.repositories import email_outbox
from tests.email.helpers import (
    RECIPIENT,
    TOKEN,
    URL,
    all_messages,
    get_message,
    make_message,
    worker_now,
)

pytestmark = mark.anyio

SessionFactory = async_sessionmaker[AsyncSession]


async def test_ct58_a_sent_message_loses_the_payload(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    message = await make_message(db)
    now = worker_now()

    handled = await run_once(session_factory, sender, now)

    assert handled == 1
    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.SENT
    assert stored.sent_at == now
    assert stored.payload is None
    assert stored.attempts == 1
    assert stored.last_error is None
    [sent] = sender.sent
    assert sent.idempotency_key == str(message.id)
    assert sent.message.to_email == RECIPIENT
    assert sent.message.subject == "Agendamento confirmado em Barbearia"
    assert URL in sent.message.text
    # Nothing is left to send.
    assert await run_once(session_factory, sender, now + timedelta(hours=1)) == 0


async def test_ct30_temporary_failures_wait_1_5_15_and_60_minutes(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    message = await make_message(db)
    sender.fail_next(FailureKind.TEMPORARY, times=MAX_ATTEMPTS - 1)
    now = worker_now()

    for attempt, delay in enumerate(RETRY_DELAYS, start=1):
        assert await run_once(session_factory, sender, now) == 1
        stored = await get_message(db, message.id)
        assert stored.status is EmailOutboxStatus.PENDING
        assert stored.attempts == attempt
        assert stored.next_attempt_at == now + delay
        assert stored.last_error == "FakeDeliveryError 503"
        assert stored.payload is not None
        # Not due a microsecond before the wait ends.
        early = now + delay - timedelta(microseconds=1)
        assert await run_once(session_factory, sender, early) == 0
        now += delay

    assert await run_once(session_factory, sender, now) == 1
    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.SENT
    assert stored.attempts == MAX_ATTEMPTS
    assert sender.attempts == MAX_ATTEMPTS
    assert len(sender.sent) == 1


async def test_ct58_five_temporary_failures_end_as_failed(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    message = await make_message(db)
    sender.fail_next(FailureKind.TEMPORARY, times=MAX_ATTEMPTS)
    now = worker_now()

    for delay in (*RETRY_DELAYS, timedelta()):
        assert await run_once(session_factory, sender, now) == 1
        now += delay

    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.FAILED
    assert stored.attempts == MAX_ATTEMPTS
    assert stored.last_error == "FakeDeliveryError 503"
    assert stored.payload is None
    assert stored.sent_at is None
    assert sender.sent == []
    assert await run_once(session_factory, sender, now + timedelta(days=1)) == 0
    assert sender.attempts == MAX_ATTEMPTS


async def test_ct59_a_permanent_failure_is_not_tried_again(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    message = await make_message(db)
    sender.fail_next(FailureKind.PERMANENT)
    now = worker_now()

    assert await run_once(session_factory, sender, now) == 1

    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.FAILED
    assert stored.attempts == 1
    assert stored.last_error == "FakeDeliveryError 422"
    assert stored.payload is None
    assert await run_once(session_factory, sender, now + timedelta(hours=2)) == 0
    assert sender.attempts == 1


async def test_ct60_a_reservation_left_by_a_dead_worker_expires(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    message = await make_message(db)
    now = worker_now()
    # A worker reserves and dies before sending.
    async with session_factory() as session:
        [claimed] = await email_outbox.claim_due(session, now, BATCH_SIZE)
        email_outbox.reserve(claimed, now + timedelta(minutes=5))
        await session.commit()

    before = await run_once(session_factory, sender, now + timedelta(minutes=4))
    after = await run_once(session_factory, sender, now + timedelta(minutes=5))

    assert before == 0
    assert after == 1
    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.SENT
    assert stored.attempts == 2
    assert len(sender.sent) == 1


async def test_d38_a_late_result_of_an_old_reservation_changes_nothing(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    """A slow worker writes after another one reserved the message again."""
    message = await make_message(db)
    now = worker_now()
    async with session_factory() as session:
        [claimed] = await email_outbox.claim_due(session, now, BATCH_SIZE)
        email_outbox.reserve(claimed, now)
        await session.commit()
    assert await run_once(session_factory, sender, now) == 1  # Attempt 2: sent.

    async with session_factory() as session:
        failed = await email_outbox.mark_failed(session, message.id, 1, "late")
        await session.commit()

    assert failed is False
    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.SENT
    assert stored.last_error is None


@mark.parametrize(
    ("age", "expired"),
    [(timedelta(hours=24, seconds=1), True), (timedelta(hours=24), False)],
    ids=["past_24_hours", "exactly_24_hours"],
)
async def test_ct61_a_message_older_than_24_hours_expires_without_sending(
    db: AsyncSession,
    session_factory: SessionFactory,
    sender: FakeSender,
    age: timedelta,
    expired: bool,
) -> None:
    now = worker_now()
    message = await make_message(db, created_at=now - age)

    assert await run_once(session_factory, sender, now) == 1

    stored = await get_message(db, message.id)
    assert stored.payload is None
    if expired:
        assert stored.status is EmailOutboxStatus.FAILED
        assert stored.last_error == "expired"
        assert stored.attempts == 0
        assert sender.attempts == 0
    else:
        assert stored.status is EmailOutboxStatus.SENT
        assert sender.attempts == 1


async def test_d38_only_due_messages_are_taken_in_order(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    now = worker_now()
    later = await make_message(db, next_attempt_at=now - timedelta(minutes=1))
    first = await make_message(db, next_attempt_at=now - timedelta(minutes=2))
    future = await make_message(db, next_attempt_at=now + timedelta(seconds=1))

    assert await run_once(session_factory, sender, now) == 2

    assert [item.idempotency_key for item in sender.sent] == [
        str(first.id),
        str(later.id),
    ]
    assert (await get_message(db, future.id)).status is EmailOutboxStatus.PENDING


async def test_d38_a_cycle_takes_at_most_20_messages(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    for _ in range(BATCH_SIZE + 5):
        await make_message(db)
    now = worker_now()

    assert await run_once(session_factory, sender, now) == BATCH_SIZE
    assert await run_once(session_factory, sender, now) == 5
    assert len(sender.sent) == BATCH_SIZE + 5


async def test_d37_a_payload_that_does_not_fit_fails_at_once(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    message = await make_message(
        db, template=EmailTemplate.APPOINTMENT_CANCELLATION, payload={"x": 1}
    )

    assert await run_once(session_factory, sender, worker_now()) == 1

    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.FAILED
    assert stored.last_error == "TemplateError"
    assert stored.payload is None
    assert sender.attempts == 0


class BrokenSender:
    """An adapter bug, outside the classified errors."""

    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        raise RuntimeError(f"bug while sending to {message.to_email}")


async def test_d39_an_unexpected_error_is_tried_again(
    db: AsyncSession, session_factory: SessionFactory
) -> None:
    message = await make_message(db)
    now = worker_now()

    assert await run_once(session_factory, BrokenSender(), now) == 1

    stored = await get_message(db, message.id)
    assert stored.status is EmailOutboxStatus.PENDING
    assert stored.last_error == "RuntimeError"
    assert stored.next_attempt_at == now + RETRY_DELAYS[0]


async def test_ct30_two_workers_never_send_the_same_message(
    db: AsyncSession, session_factory: SessionFactory
) -> None:
    for _ in range(10):
        await make_message(db)
    first, second = FakeSender(), FakeSender()
    now = worker_now()

    handled = await asyncio.gather(
        run_once(session_factory, first, now),
        run_once(session_factory, second, now),
    )

    assert sum(handled) == 10
    keys = [item.idempotency_key for item in [*first.sent, *second.sent]]
    assert len(keys) == len(set(keys)) == 10
    stored = await all_messages(db)
    assert {message.status for message in stored} == {EmailOutboxStatus.SENT}
    assert {message.attempts for message in stored} == {1}


async def test_ct62_logs_and_errors_never_show_recipient_link_nor_token(
    db: AsyncSession,
    session_factory: SessionFactory,
    sender: FakeSender,
    caplog: LogCaptureFixture,
) -> None:
    """Refused, retried, sent and expired: none of them leaks contact or link."""
    caplog.set_level(logging.DEBUG, logger="app")

    def echo_everything(request: httpx.Request) -> httpx.Response:
        """A provider that repeats the whole request in the body of its refusal."""
        return httpx.Response(422, text=f"invalid: {request.content.decode()}")

    resend = ResendSender(
        "chave-de-teste",
        "Agenda <nao-responda@app.test>",
        transport=httpx.MockTransport(echo_everything),
    )
    refused = await make_message(db)
    await run_once(session_factory, resend, worker_now())
    retried = await make_message(db)
    sent = await make_message(db)
    expired = await make_message(db, created_at=worker_now(-timedelta(days=2)))
    sender.fail_next(FailureKind.TEMPORARY)

    assert await run_once(session_factory, sender, worker_now()) == 3

    errors = {message.id: message.last_error for message in await all_messages(db)}
    assert errors == {
        refused.id: "HTTPStatusError 422",
        retried.id: "FakeDeliveryError 503",
        sent.id: None,
        expired.id: "expired",
    }
    for secret in (RECIPIENT, TOKEN, URL, "chave-de-teste"):
        assert secret not in caplog.text
    # The log keeps what is needed to follow a message.
    assert f"email {refused.id} template=appointment_confirmation status=failed" in (
        caplog.text
    )
    assert f"email {sent.id} template=appointment_confirmation status=sent" in (
        caplog.text
    )


async def test_serve_runs_until_stopped(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    await make_message(db)
    stop = asyncio.Event()

    def clock() -> datetime:
        stop.set()  # The cycle that reads the clock is the last one.
        return worker_now()

    await asyncio.wait_for(
        serve(session_factory, sender, stop, clock=clock, interval=60), timeout=5
    )

    assert len(sender.sent) == 1


async def test_serve_goes_on_at_once_after_a_full_batch(
    db: AsyncSession, session_factory: SessionFactory, sender: FakeSender
) -> None:
    for _ in range(BATCH_SIZE + 1):
        await make_message(db)
    stop = asyncio.Event()
    calls: list[datetime] = []

    def clock() -> datetime:
        calls.append(worker_now())
        if len(calls) == 2:
            stop.set()
        return calls[-1]

    await asyncio.wait_for(
        serve(session_factory, sender, stop, clock=clock, interval=60), timeout=5
    )

    assert len(calls) == 2
    assert len(sender.sent) == BATCH_SIZE + 1


async def test_serve_survives_a_failed_cycle(
    sender: FakeSender, caplog: LogCaptureFixture
) -> None:
    stop = asyncio.Event()
    calls: list[int] = []

    def broken_factory() -> Any:
        calls.append(1)
        if len(calls) == 2:
            stop.set()
        raise ConnectionRefusedError("database down at db:5432")

    await asyncio.wait_for(
        serve(cast(SessionFactory, broken_factory), sender, stop, interval=0),
        timeout=5,
    )

    assert len(calls) == 2
    assert "email worker cycle failed: ConnectionRefusedError" in caplog.text
    assert "db:5432" not in caplog.text
