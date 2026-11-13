"""D105 and D106: the e-mail worker and the daily demo restoration inside the API.

For hosts without a worker of their own (Render's free plan). Each one is an
`asyncio` task started by the API's lifespan, turned on by its own variable
(`EMAIL_WORKER_IN_PROCESS` and `DEMO_RESTORE_IN_PROCESS`), so a real
installation can send e-mails without ever restoring the demo. Both share one
`stop` event: on shutdown (Render's SIGTERM when it restarts the service or
puts it to sleep) they leave between cycles, and whatever is still running
after `SHUTDOWN_TIMEOUT_SECONDS` is cancelled. A cancelled send keeps its
reservation and is sent again when it expires (D38).

Neither task blocks the requests: every database, HTTP and SMTP call awaits,
and Argon2 runs in a thread. Neither one stops the API nor the other task:
each cycle catches its own failures.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Coroutine
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.database import get_engine
from app.email.factory import build_sender
from app.email.sender import EmailSender
from app.jobs.cleanup import clean_up
from app.jobs.email_worker import POLL_INTERVAL_SECONDS, serve
from app.jobs.restore_demo import restore_demo_if_due
from app.services.demo_restore import DemoRestoreError, DemoRestoreReport

# D106: how often the API checks whether the demo is of an earlier day.
RESTORE_CHECK_INTERVAL_SECONDS = 600.0
# Within the 30 seconds Render waits after SIGTERM by default.
SHUTDOWN_TIMEOUT_SECONDS = 10.0

logger = logging.getLogger(__name__)

SessionFactory = async_sessionmaker[AsyncSession]
Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(UTC)


async def restore_and_clean_up(
    session_factory: SessionFactory, settings: Settings, now: datetime
) -> DemoRestoreReport | None:
    """One check of D106. Never raises: a failure waits for the next check.

    After a restoration, the cleanup of D115 runs in a transaction of its own,
    so a failure there never undoes the restored demo.
    """
    try:
        async with session_factory() as session:
            report = await restore_demo_if_due(session, settings, now)
    except DemoRestoreError as exc:
        # The message never holds personal data (D49).
        logger.error("demo restore refused: %s", exc)
        return None
    except Exception as exc:
        logger.error("demo restore failed: %s", type(exc).__name__)
        return None
    if report is not None:
        try:
            await clean_up(session_factory, now)
        except Exception as exc:
            logger.error("cleanup failed: %s", type(exc).__name__)
    return report


async def serve_demo_restore(
    session_factory: SessionFactory,
    settings: Settings,
    stop: asyncio.Event,
    *,
    clock: Clock = _utc_now,
    interval: float = RESTORE_CHECK_INTERVAL_SECONDS,
) -> None:
    """Checks at once, then every `interval` seconds, until `stop` is set."""
    while not stop.is_set():
        await restore_and_clean_up(session_factory, settings, clock())
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass


def _log_end(task: asyncio.Task[None]) -> None:
    """A task that dies by mistake is logged; the API goes on serving."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.critical("%s stopped: %s", task.get_name(), type(exc).__name__)


def _start(coroutine: Coroutine[Any, Any, None], name: str) -> asyncio.Task[None]:
    task = asyncio.create_task(coroutine, name=name)
    task.add_done_callback(_log_end)
    logger.info("%s started in the API process", name)
    return task


async def stop_tasks(tasks: list[asyncio.Task[None]], timeout: float) -> None:
    """Waits up to `timeout` seconds for the tasks, then cancels the rest."""
    if not tasks:
        return
    _, pending = await asyncio.wait(tasks, timeout=timeout)
    for task in pending:
        logger.warning("%s did not stop in %.0fs; cancelling", task.get_name(), timeout)
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("background tasks stopped")


@asynccontextmanager
async def background_tasks(
    settings: Settings,
    *,
    session_factory: SessionFactory | None = None,
    sender: EmailSender | None = None,
    clock: Clock = _utc_now,
    worker_interval: float = POLL_INTERVAL_SECONDS,
    restore_interval: float = RESTORE_CHECK_INTERVAL_SECONDS,
    shutdown_timeout: float = SHUTDOWN_TIMEOUT_SECONDS,
) -> AsyncIterator[list[asyncio.Task[None]]]:
    """Starts the tasks turned on in `settings` and returns at once.

    Nothing here waits for a cycle, so the API opens its port without delay and
    the first send and the first check run in the background.
    """
    factory = session_factory or async_sessionmaker(
        get_engine(), expire_on_commit=False
    )
    stop = asyncio.Event()
    tasks: list[asyncio.Task[None]] = []
    if settings.email_worker_in_process:
        tasks.append(
            _start(
                serve(
                    factory,
                    sender or build_sender(settings),
                    stop,
                    clock=clock,
                    interval=worker_interval,
                ),
                "email worker",
            )
        )
    if settings.demo_restore_in_process:
        tasks.append(
            _start(
                serve_demo_restore(
                    factory, settings, stop, clock=clock, interval=restore_interval
                ),
                "demo restore",
            )
        )
    try:
        yield tasks
    finally:
        stop.set()
        await stop_tasks(tasks, shutdown_timeout)
