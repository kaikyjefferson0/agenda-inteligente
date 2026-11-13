"""Sends the outbox (D38 to D40). Run with `python -m app.jobs.email_worker`.

Each cycle reserves a batch in a short transaction, sends it outside any
transaction and writes each result in another short one. A worker that dies
mid-way leaves reservations that expire, so delivery is "at least once"; the
message id is the idempotency key that lets the provider drop a repeat.

The same loop runs the daily cleanup of D115, because every installation has a
worker: its own process in development, a task inside the API in production
(D105, `app/jobs/in_process.py`).
"""

import asyncio
import logging
import signal
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.database import get_engine
from app.domain.email_retry import (
    EXPIRED_ERROR,
    RESERVATION,
    FailureKind,
    GiveUp,
    after_failure,
    error_summary,
    is_expired,
)
from app.domain.rate_limits import ONE_DAY
from app.email.factory import build_sender
from app.email.rendering import TemplateError, render
from app.email.sender import EmailDeliveryError, EmailSender
from app.jobs.cleanup import clean_up
from app.models import EmailOutboxStatus
from app.repositories import email_outbox

BATCH_SIZE = 20
POLL_INTERVAL_SECONDS = 5.0
# D115: once a day; after a failure, an hour later.
CLEANUP_INTERVAL = ONE_DAY
CLEANUP_RETRY = timedelta(hours=1)

logger = logging.getLogger(__name__)

SessionFactory = async_sessionmaker[AsyncSession]


@dataclass(frozen=True)
class _Reserved:
    """Copied before the commit, so the delivery needs no session."""

    id: UUID
    to_email: str
    template: str
    payload: dict[str, Any]
    attempts: int


def _log(message_id: UUID, template: str, status: str, attempt: int) -> None:
    """D40: never the recipient, the link nor the payload."""
    logger.info(
        "email %s template=%s status=%s attempt=%d",
        message_id,
        template,
        status,
        attempt,
    )


async def _reserve_batch(
    session_factory: SessionFactory, now: datetime
) -> tuple[int, list[_Reserved]]:
    async with session_factory() as session:
        claimed = await email_outbox.claim_due(session, now, BATCH_SIZE)
        reserved: list[_Reserved] = []
        for message in claimed:
            if is_expired(message.created_at, now):
                email_outbox.expire(message, EXPIRED_ERROR)
                _log(message.id, message.template, "expired", message.attempts)
                continue
            email_outbox.reserve(message, now + RESERVATION)
            # The CHECK pending_requires_recipient_and_payload rules out None.
            assert message.to_email is not None and message.payload is not None
            reserved.append(
                _Reserved(
                    message.id,
                    message.to_email,
                    message.template,
                    dict(message.payload),
                    message.attempts,
                )
            )
        await session.commit()
    return len(claimed), reserved


async def _record_failure(
    session: AsyncSession,
    item: _Reserved,
    kind: FailureKind,
    summary: str,
    now: datetime,
) -> str:
    step = after_failure(item.attempts, kind, now)
    if isinstance(step, GiveUp):
        await email_outbox.mark_failed(session, item.id, item.attempts, summary)
        return EmailOutboxStatus.FAILED
    await email_outbox.mark_retry(
        session, item.id, item.attempts, step.next_attempt_at, summary
    )
    return "retry"


async def _deliver(
    session_factory: SessionFactory,
    sender: EmailSender,
    item: _Reserved,
    now: datetime,
) -> None:
    failure: tuple[FailureKind, str] | None = None
    try:
        message = render(item.template, item.payload).to(item.to_email)
    except TemplateError as exc:
        # The payload will not change, so trying again is pointless.
        failure = (FailureKind.PERMANENT, error_summary(type(exc).__name__))
    else:
        try:
            await sender.send(message, str(item.id))
        except EmailDeliveryError as exc:
            failure = (exc.kind, exc.summary)
        except Exception as exc:  # An adapter bug must not stop the batch.
            failure = (FailureKind.TEMPORARY, error_summary(type(exc).__name__))

    async with session_factory() as session:
        if failure is None:
            await email_outbox.mark_sent(session, item.id, item.attempts, now)
            status: str = EmailOutboxStatus.SENT
        else:
            status = await _record_failure(session, item, *failure, now)
        await session.commit()
    _log(item.id, item.template, status, item.attempts)


async def run_once(
    session_factory: SessionFactory, sender: EmailSender, now: datetime
) -> int:
    """One cycle. Returns how many messages it handled, expired ones included."""
    handled, reserved = await _reserve_batch(session_factory, now)
    for item in reserved:
        await _deliver(session_factory, sender, item, now)
    return handled


async def serve(
    session_factory: SessionFactory,
    sender: EmailSender,
    stop: asyncio.Event,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    interval: float = POLL_INTERVAL_SECONDS,
) -> None:
    """Runs a cycle every `interval` seconds until `stop` is set.

    A full batch is followed at once by the next one. A failed cycle, such as
    the database being down, is logged by type and tried again later. The
    cleanup of D115 runs on the first cycle and then once a day.
    """
    next_cleanup: datetime | None = None
    while not stop.is_set():
        now = clock()
        if next_cleanup is None or now >= next_cleanup:
            next_cleanup = now + await _clean_up(session_factory, now)
        try:
            handled = await run_once(session_factory, sender, now)
        except Exception as exc:
            logger.error("email worker cycle failed: %s", type(exc).__name__)
            handled = 0
        if handled >= BATCH_SIZE:
            continue
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass


async def _clean_up(session_factory: SessionFactory, now: datetime) -> timedelta:
    """Returns how long until the next cleanup. A failure never stops the sends."""
    try:
        await clean_up(session_factory, now)
    except Exception as exc:
        logger.error("cleanup failed: %s", type(exc).__name__)
        return CLEANUP_RETRY
    return CLEANUP_INTERVAL


async def _main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, stop.set)
    settings = get_settings()
    engine = get_engine()
    logger.info("email worker started with backend=%s", settings.email_backend)
    try:
        await serve(
            async_sessionmaker(engine, expire_on_commit=False),
            build_sender(settings),
            stop,
        )
    finally:
        await engine.dispose()
    logger.info("email worker stopped")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    asyncio.run(_main())


if __name__ == "__main__":
    main()
