"""D42 to D47: rebuilding the demo business from scratch, in the caller's transaction.

`app.jobs.restore_demo` takes the lock, calls `rebuild` and commits. Every
refusal comes before the first write, so a refused restoration deletes nothing.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import generate_opaque_token, hash_opaque_token
from app.domain.auth import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH
from app.domain.demo_schedule import (
    DemoProfessional,
    PlannedAppointment,
    PlannedTimeBlock,
    plan_appointments,
    plan_time_block,
)
from app.models import (
    Appointment,
    AppointmentOrigin,
    AppointmentStatus,
    Base,
    Business,
    Professional,
    ProfessionalService,
    Service,
    TimeBlock,
    User,
    WorkingHours,
)
from app.repositories import demo
from app.services import demo_content as content

# D47: the reason left on the messages whose links stop working.
DEMO_RESTORED_ERROR = "demo_restored"


class DemoRestoreError(Exception):
    """Refused before any write. The message never holds personal data (D49)."""


@dataclass(frozen=True)
class DemoRestoreReport:
    """D49: only counts per table, never names, e-mails nor passwords."""

    deleted: dict[str, int]
    created: dict[str, int]
    failed_emails: int


def demo_password(settings: Settings) -> str:
    """D46: without a valid DEMO_PASSWORD (RN30), the restoration does not run."""
    if settings.demo_password is None:
        raise DemoRestoreError("DEMO_PASSWORD is not set")
    password = settings.demo_password.get_secret_value()
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise DemoRestoreError(
            f"DEMO_PASSWORD must have {PASSWORD_MIN_LENGTH} to "
            f"{PASSWORD_MAX_LENGTH} characters"
        )
    return password


async def find_demo_business(session: AsyncSession) -> UUID | None:
    """D46: the demo business that may be deleted, or a refusal.

    Refuses more than one demo business, the slug in use by another business,
    and a demo e-mail in use by a user of another business.
    """
    demo_ids = await demo.list_demo_business_ids(session)
    if len(demo_ids) > 1:
        raise DemoRestoreError("there is more than one demo business")
    current = demo_ids[0] if demo_ids else None
    if await demo.is_slug_used_by_other_business(session, content.SLUG, current):
        raise DemoRestoreError(
            f"the slug {content.SLUG} belongs to a business that is not the demo"
        )
    if await demo.is_email_used_by_other_business(
        session, content.STAFF_EMAILS, current
    ):
        raise DemoRestoreError("a demo account e-mail belongs to another business")
    return current


def _schedule_professionals() -> list[DemoProfessional]:
    return [
        DemoProfessional(
            key=str(account.professional_id),
            intervals=content.WORKING_HOURS,
            services=[
                service.schedule
                for service in content.SERVICES_BY_PROFESSIONAL[account.professional_id]
            ],
        )
        for account in content.ACCOUNTS
    ]


def _appointment_row(index: int, planned: PlannedAppointment) -> dict[str, Any]:
    service = next(s for s in content.SERVICES if str(s.id) == planned.service.key)
    customer = content.CUSTOMERS[index % len(content.CUSTOMERS)]
    every = content.STAFF_WITHOUT_EMAIL_EVERY
    with_email = index % every != every - 1
    status = AppointmentStatus(planned.status)
    return {
        "id": content.derived_id("appointment", planned.key),
        "business_id": content.BUSINESS_ID,
        "professional_id": UUID(planned.professional_key),
        "service_id": service.id,
        "starts_at": planned.starts_at,
        "ends_at": planned.ends_at,
        "blocked_until": planned.blocked_until,
        # RN11: copies of the service.
        "duration_minutes": service.duration_minutes,
        "preparation_minutes": service.preparation_minutes,
        "price_cents": service.price_cents,
        "customer_name": customer.name,
        "customer_email": customer.email if with_email else None,
        "customer_phone": customer.phone,
        "status": status,
        "origin": AppointmentOrigin.PUBLIC if with_email else AppointmentOrigin.STAFF,
        # D44: the database demands a token for every e-mail; nobody receives it.
        "access_token_hash": (
            hash_opaque_token(generate_opaque_token()) if with_email else None
        ),
        "cancelled_at": (
            planned.starts_at - timedelta(days=1)
            if status is AppointmentStatus.CANCELLED
            else None
        ),
    }


def _time_block_row(block: PlannedTimeBlock, today: date) -> dict[str, Any]:
    return {
        "id": content.derived_id("time_block", today.isoformat()),
        "business_id": content.BUSINESS_ID,
        "professional_id": UUID(block.professional_key),
        "starts_at": block.starts_at,
        "ends_at": block.ends_at,
        "reason": content.TIME_BLOCK_REASON,
    }


def build_rows(
    today: date, password_hashes: Mapping[UUID, str]
) -> list[tuple[type[Base], list[dict[str, Any]]]]:
    """D43 and D44: every row of the demo, in the order the foreign keys need."""
    timezone = ZoneInfo(content.TIMEZONE)
    professionals = _schedule_professionals()
    block = plan_time_block(today, professionals[-1], timezone)
    blocks = [block] if block is not None else []
    planned = plan_appointments(
        today,
        professionals,
        timezone,
        step_minutes=content.SLOT_STEP_MINUTES,
        time_blocks=blocks,
    )
    business = {
        "id": content.BUSINESS_ID,
        "name": content.BUSINESS_NAME,
        "slug": content.SLUG,
        "timezone": content.TIMEZONE,
        "slot_step_minutes": content.SLOT_STEP_MINUTES,
        "is_demo": True,
    }
    users = [
        {
            "id": account.user_id,
            "business_id": content.BUSINESS_ID,
            "name": account.name,
            "email": account.email,
            "password_hash": password_hashes[account.user_id],
            "role": account.role,
        }
        for account in content.ACCOUNTS
    ]
    professional_rows = [
        {
            "id": account.professional_id,
            "business_id": content.BUSINESS_ID,
            "user_id": account.user_id,
            "is_bookable": True,
        }
        for account in content.ACCOUNTS
    ]
    services = [
        {
            "id": service.id,
            "business_id": content.BUSINESS_ID,
            "name": service.name,
            "duration_minutes": service.duration_minutes,
            "preparation_minutes": service.preparation_minutes,
            "price_cents": service.price_cents,
        }
        for service in content.SERVICES
    ]
    links = [
        {
            "business_id": content.BUSINESS_ID,
            "professional_id": professional_id,
            "service_id": service.id,
        }
        for professional_id, served in content.SERVICES_BY_PROFESSIONAL.items()
        for service in served
    ]
    hours = [
        {
            "id": content.derived_id(
                "working_hours",
                f"{account.professional_id}/{interval.weekday}/{interval.start_time}",
            ),
            "business_id": content.BUSINESS_ID,
            "professional_id": account.professional_id,
            "weekday": interval.weekday,
            "start_time": interval.start_time,
            "end_time": interval.end_time,
        }
        for account in content.ACCOUNTS
        for interval in content.WORKING_HOURS
    ]
    return [
        (Business, [business]),
        (User, users),
        (Professional, professional_rows),
        (Service, services),
        (ProfessionalService, links),
        (WorkingHours, hours),
        (TimeBlock, [_time_block_row(item, today) for item in blocks]),
        (
            Appointment,
            [_appointment_row(index, item) for index, item in enumerate(planned)],
        ),
    ]


async def rebuild(
    session: AsyncSession, password_hashes: Mapping[UUID, str], now: datetime
) -> DemoRestoreReport:
    """D42 and D47: checks, retires the e-mails, deletes and creates again.

    The caller holds the lock of D45 and commits.
    """
    current = await find_demo_business(session)
    failed_emails = await demo.fail_pending_emails(
        session,
        current,
        staff_domain=content.STAFF_EMAIL_DOMAIN,
        customer_domain=content.CUSTOMER_EMAIL_DOMAIN,
        error=DEMO_RESTORED_ERROR,
    )
    deleted = await demo.delete_business(session, current) if current else {}

    today = now.astimezone(ZoneInfo(content.TIMEZONE)).date()
    created: dict[str, int] = {}
    for model, rows in build_rows(today, password_hashes):
        created[model.__tablename__] = await demo.insert_rows(session, model, rows)
    return DemoRestoreReport(deleted, created, failed_emails)
