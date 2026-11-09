from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.jobs.restore_demo import restore_demo
from app.models import (
    AccountToken,
    Appointment,
    Base,
    Business,
    EmailOutbox,
    Professional,
    ProfessionalService,
    RefreshToken,
    Service,
    TimeBlock,
    User,
    WorkingHours,
)
from app.services import demo_content as content
from app.services.demo_restore import DemoRestoreReport

DEMO_PASSWORD = "senha-da-demo-123"
DEMO_ZONE = ZoneInfo(content.TIMEZONE)
OWNER_EMAIL = content.OWNER.email
PROFESSIONAL_EMAIL = content.PROFESSIONAL.email
BUSINESS_TABLES: tuple[type[Base], ...] = (
    Business,
    User,
    Professional,
    Service,
    ProfessionalService,
    WorkingHours,
    TimeBlock,
    Appointment,
)
ALL_TABLES: tuple[type[Base], ...] = (
    *BUSINESS_TABLES,
    AccountToken,
    RefreshToken,
    EmailOutbox,
)
# Stamped by the server on every insert, or random by design (D44).
VOLATILE = {"created_at", "updated_at", "password_hash", "access_token_hash"}


async def restore(
    engine: AsyncEngine, settings: Settings, now: datetime
) -> DemoRestoreReport:
    """The job's function, with a session of its own, as `main()` gives it."""
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        return await restore_demo(session, settings, now)


def local_today(now: datetime) -> date:
    return now.astimezone(DEMO_ZONE).date()


def next_working_day(now: datetime) -> date:
    """Tomorrow, or the first day after it with working hours (D43)."""
    weekdays = {interval.weekday for interval in content.WORKING_HOURS}
    day = local_today(now) + timedelta(days=1)
    while day.weekday() not in weekdays:
        day += timedelta(days=1)
    return day


def _ordered(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: sorted((k, str(v)) for k, v in row.items()))


async def business_rows(
    db: AsyncSession, business_id: UUID, *, exclude: set[str] | None = None
) -> dict[str, list[dict[str, Any]]]:
    """Every row of a business and of its users' tokens, comparable as a whole."""
    hidden = exclude or set()
    snapshot: dict[str, list[dict[str, Any]]] = {}
    user_ids = select(User.id).where(User.business_id == business_id)
    for model in (*BUSINESS_TABLES, AccountToken, RefreshToken):
        table = model.__table__
        if model is Business:
            condition = table.c.id == business_id
        elif model in (AccountToken, RefreshToken):
            condition = table.c.user_id.in_(user_ids)
        else:
            condition = table.c.business_id == business_id
        result = await db.execute(select(table).where(condition))
        snapshot[table.name] = _ordered(
            [
                {k: v for k, v in row.items() if k not in hidden}
                for row in result.mappings()
            ]
        )
    return snapshot


async def outbox_rows(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(select(EmailOutbox.__table__))
    return _ordered([dict(row) for row in result.mappings()])


async def table_counts(db: AsyncSession) -> dict[str, int]:
    counts: dict[str, int] = {}
    for model in ALL_TABLES:
        count = await db.scalar(select(func.count()).select_from(model))
        counts[model.__tablename__] = count or 0
    return counts


async def demo_appointments(db: AsyncSession) -> list[Appointment]:
    rows = await db.scalars(
        select(Appointment)
        .where(Appointment.business_id == content.BUSINESS_ID)
        .order_by(Appointment.starts_at, Appointment.id)
        .execution_options(populate_existing=True)
    )
    return list(rows)
