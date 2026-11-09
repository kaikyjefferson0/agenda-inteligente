"""D42, D46 and D47: the queries of the demo restoration.

Every deletion is scoped to one business id, found with `is_demo = true`. The
foreign keys use ON DELETE RESTRICT, so the dependents go first.
"""

from collections.abc import Iterable, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, delete, func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.models import (
    AccountToken,
    Appointment,
    Base,
    Business,
    EmailOutbox,
    EmailOutboxStatus,
    Professional,
    ProfessionalService,
    RefreshToken,
    Service,
    TimeBlock,
    User,
    WorkingHours,
)

_Target = tuple[type[Base], ColumnElement[bool], InstrumentedAttribute[Any]]


async def lock_restoration(session: AsyncSession, key: int) -> None:
    """D45: held until the transaction ends, so restorations run one at a time."""
    await session.execute(select(func.pg_advisory_xact_lock(key)))


async def list_demo_business_ids(session: AsyncSession) -> list[UUID]:
    rows = await session.scalars(
        select(Business.id).where(Business.is_demo.is_(True)).order_by(Business.id)
    )
    return list(rows)


async def is_slug_used_by_other_business(
    session: AsyncSession, slug: str, demo_business_id: UUID | None
) -> bool:
    """The slug is citext, so the comparison ignores case."""
    query = select(Business.id).where(Business.slug == slug)
    if demo_business_id is not None:
        query = query.where(Business.id != demo_business_id)
    return await session.scalar(query.limit(1)) is not None


async def is_email_used_by_other_business(
    session: AsyncSession, emails: Iterable[str], demo_business_id: UUID | None
) -> bool:
    """The e-mail is citext and unique in the whole system."""
    query = select(User.id).where(User.email.in_(list(emails)))
    if demo_business_id is not None:
        query = query.where(User.business_id != demo_business_id)
    return await session.scalar(query.limit(1)) is not None


async def fail_pending_emails(
    session: AsyncSession,
    business_id: UUID | None,
    *,
    staff_domain: str,
    customer_domain: str,
    error: str,
) -> int:
    """D47: the links in these messages die with the restoration.

    The outbox has no business_id, so the messages are found by recipient: the
    staff domain of the demo, and the customers of the demo in the example
    domain. The payload is erased in the same write, as the CHECK demands.
    """
    recipient = func.lower(EmailOutbox.to_email)
    targets = [recipient.like(f"%@{staff_domain}")]
    if business_id is not None:
        customers: Select[Any] = select(func.lower(Appointment.customer_email)).where(
            Appointment.business_id == business_id,
            func.lower(Appointment.customer_email).like(f"%@{customer_domain}"),
        )
        targets.append(recipient.in_(customers))
    result = await session.execute(
        update(EmailOutbox)
        .where(EmailOutbox.status == EmailOutboxStatus.PENDING, or_(*targets))
        .values(status=EmailOutboxStatus.FAILED, payload=None, last_error=error)
        .returning(EmailOutbox.id)
    )
    return len(result.all())


async def delete_business(session: AsyncSession, business_id: UUID) -> dict[str, int]:
    """D42: deletes the business and every row that depends on it, in order.

    Returns how many rows each table lost.
    """
    demo_users = select(User.id).where(User.business_id == business_id)
    # Each table with its condition and a column the deletion returns, to count.
    targets: tuple[_Target, ...] = (
        (Appointment, Appointment.business_id == business_id, Appointment.id),
        (TimeBlock, TimeBlock.business_id == business_id, TimeBlock.id),
        (WorkingHours, WorkingHours.business_id == business_id, WorkingHours.id),
        (
            ProfessionalService,
            ProfessionalService.business_id == business_id,
            ProfessionalService.professional_id,
        ),
        (Professional, Professional.business_id == business_id, Professional.id),
        (Service, Service.business_id == business_id, Service.id),
        (AccountToken, AccountToken.user_id.in_(demo_users), AccountToken.id),
        (RefreshToken, RefreshToken.user_id.in_(demo_users), RefreshToken.id),
        (User, User.business_id == business_id, User.id),
        (Business, Business.id == business_id, Business.id),
    )
    deleted: dict[str, int] = {}
    for model, condition, column in targets:
        result = await session.execute(delete(model).where(condition).returning(column))
        deleted[model.__tablename__] = len(result.all())
    return deleted


async def insert_rows(
    session: AsyncSession, model: type[Base], rows: Sequence[dict[str, Any]]
) -> int:
    """Inserts in one statement; the timestamps come from the server defaults."""
    if rows:
        await session.execute(insert(model), list(rows))
    return len(rows)
