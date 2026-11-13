"""Restores the demo business (RN29, D42 to D49).

Run with `python -m app.jobs.restore_demo`, which always restores. In
production, the API itself restores the demo once a day, after 03:00 in
America/Sao_Paulo, through `restore_demo_if_due` (D106, `app/jobs/in_process.py`).
It creates the demo when it does not exist, and running it again gives the same
data for the same day.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.database import get_engine
from app.core.security import hash_password
from app.domain.daily_jobs import restoration_due
from app.repositories import demo
from app.services import demo_content as content
from app.services.demo_restore import (
    DemoRestoreError,
    DemoRestoreReport,
    demo_password,
    rebuild,
)

logger = logging.getLogger(__name__)


def _counts(counts: dict[str, int]) -> str:
    return " ".join(f"{table}={count}" for table, count in counts.items()) or "none"


def _log(report: DemoRestoreReport, seconds: float) -> None:
    """D49: counts per table and the duration; never names, e-mails nor passwords."""
    logger.info("demo deleted %s", _counts(report.deleted))
    logger.info("demo created %s", _counts(report.created))
    logger.info("demo email_outbox failed=%d", report.failed_emails)
    logger.info("demo restored in %.2fs", seconds)


async def _restore(
    session: AsyncSession, settings: Settings, now: datetime, *, only_if_due: bool
) -> DemoRestoreReport | None:
    started = time.monotonic()
    password = demo_password(settings)
    # Argon2 is slow: hashing before the lock keeps the transaction short.
    password_hashes = {
        account.user_id: await hash_password(password) for account in content.ACCOUNTS
    }
    try:
        # D45: a second run waits here and then finds the first one's data.
        await demo.lock_restoration(session, content.RESTORE_LOCK_KEY)
        if only_if_due and not restoration_due(
            await demo.restored_at(session), now, ZoneInfo(content.TIMEZONE)
        ):
            # D106: another process restored it while this one waited.
            await session.rollback()
            logger.info("demo already restored today")
            return None
        report = await rebuild(session, password_hashes, now)
        await session.commit()
    except BaseException:
        await session.rollback()
        raise
    _log(report, time.monotonic() - started)
    return report


async def restore_demo(
    session: AsyncSession, settings: Settings, now: datetime
) -> DemoRestoreReport:
    """Deletes and recreates the demo in a single transaction, then commits.

    Raises DemoRestoreError, with nothing changed, when the password is invalid
    or the demo's slug or e-mails belong to another business (D46).
    """
    report = await _restore(session, settings, now, only_if_due=False)
    assert report is not None  # Only a conditional run skips.
    return report


async def restore_demo_if_due(
    session: AsyncSession, settings: Settings, now: datetime
) -> DemoRestoreReport | None:
    """D106: restores only when the demo is of an earlier day and it is past 03:00.

    A cheap read decides first, so the Argon2 hashes are only computed when a
    restoration is due; the same check is repeated under the lock of D45, so
    two processes (a deploy overlap, or a manual run) restore once. Returns None
    when nothing was done.
    """
    timezone = ZoneInfo(content.TIMEZONE)
    due = restoration_due(await demo.restored_at(session), now, timezone)
    # Ends the read transaction, so the lock is taken in a fresh one.
    await session.rollback()
    if not due:
        return None
    return await _restore(session, settings, now, only_if_due=True)


async def _main() -> int:
    engine = get_engine()
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            await restore_demo(session, get_settings(), datetime.now(UTC))
    except DemoRestoreError as exc:
        logger.error("demo restore refused: %s", exc)
        return 1
    finally:
        await engine.dispose()
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    raise SystemExit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
